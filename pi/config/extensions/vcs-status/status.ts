import { execFile } from "node:child_process";

export interface Status {
  text: string;
  dirty: boolean;
  warning?: boolean;
}

export type Run = (command: string, args: string[], cwd: string) => Promise<string>;

export const run: Run = (command, args, cwd) => new Promise((resolve, reject) => {
  execFile(command, args, {
    cwd,
    timeout: 2000,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    windowsHide: true,
  }, (error, stdout) => error ? reject(error) : resolve(stdout.trimEnd()));
});

function label(value: string): string {
  return value.replace(/[\x00-\x1f\x7f-\x9f]/g, "").slice(0, 60);
}

export function gitStatus(branch: string, porcelain: string): Status {
  let staged = 0, unstaged = 0, untracked = 0;
  for (const line of porcelain.split("\n")) {
    if (line.length < 2) continue;
    if (line.startsWith("??")) { untracked++; continue; }
    if (line[0] !== " ") staged++;
    if (line[1] !== " ") unstaged++;
  }
  const counts = [staged ? `+${staged}` : "", unstaged ? `*${unstaged}` : "", untracked ? `?${untracked}` : ""].filter(Boolean);
  return { text: [label(branch), ...counts].join(" "), dirty: counts.length > 0 };
}

export function butStatus(value: unknown): Status {
  const data = value as {
    stacks?: { assignedChanges?: { filePath: string }[]; branches: { name: string; commits: { conflicted?: boolean }[] }[] }[];
    uncommittedChanges?: { filePath: string }[];
  };
  if (!data || !Array.isArray(data.stacks) || !Array.isArray(data.uncommittedChanges)) {
    throw new Error("Unsupported GitButler status schema");
  }
  const stacks = data.stacks.map(stack => stack.branches.map(branch => label(branch.name)).join(" → ")).filter(Boolean);
  const names = stacks.slice(0, 2).join(" | ") || "no branches";
  const overflow = stacks.length > 2 ? ` +${stacks.length - 2} stacks` : "";
  const files = new Set([...data.uncommittedChanges, ...data.stacks.flatMap(stack => stack.assignedChanges ?? [])].map(change => change.filePath));
  const conflicted = data.stacks.some(stack => stack.branches.some(branch => branch.commits.some(commit => commit.conflicted)));
  return {
    text: `${names}${overflow}${files.size ? ` *${files.size}` : ""}${conflicted ? " !conflicts" : ""}`,
    dirty: files.size > 0,
    warning: conflicted,
  };
}

/** Only invoke GitButler in its synthetic workspace, never in ordinary repos. */
export async function readStatus(cwd: string, execute: Run = run): Promise<Status | undefined> {
  let branch: string;
  try {
    await execute("git", ["rev-parse", "--git-dir"], cwd);
  } catch {
    return undefined;
  }
  try {
    branch = await execute("git", ["symbolic-ref", "--short", "HEAD"], cwd);
  } catch {
    try {
      branch = `${await execute("git", ["rev-parse", "--short", "HEAD"], cwd)} (detached)`;
    } catch {
      return undefined;
    }
  }
  if (branch === "gitbutler/workspace") {
    try {
      return butStatus(JSON.parse(await execute("but", ["status", "--json"], cwd)));
    } catch {
      return { text: "GitButler unavailable", dirty: false, warning: true };
    }
  }
  try {
    return gitStatus(branch, await execute("git", ["status", "--porcelain", "--untracked-files=normal"], cwd));
  } catch {
    return { text: `${label(branch)} (status unavailable)`, dirty: false, warning: true };
  }
}
