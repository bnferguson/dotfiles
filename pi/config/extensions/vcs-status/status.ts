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
  try {
    return gitStatus(branch, await execute("git", ["status", "--porcelain", "--untracked-files=normal"], cwd));
  } catch {
    return { text: `${label(branch)} (status unavailable)`, dirty: false, warning: true };
  }
}
