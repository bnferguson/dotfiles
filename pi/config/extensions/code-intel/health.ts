import { createHash } from "node:crypto";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Health, IndexBackend } from "./observability.ts";

export type Execute = (bin: string, args: string[], options: { cwd: string; timeout: number }) => Promise<{ code: number; stdout: string; stderr: string }>;
export interface WorkspaceSnapshot { fingerprint: string; head?: string; dirty: boolean; latestDirtyMtime?: number }

// Hash names and mtimes in memory. Neither paths nor diff/source text enter the
// maintenance journal. -z preserves spaces and non-ASCII names without quoting.
export async function workspaceSnapshot(cwd: string, execute: Execute): Promise<WorkspaceSnapshot> {
  const [head, status] = await Promise.all([
    execute("git", ["-C", cwd, "rev-parse", "HEAD"], { cwd, timeout: 2000 }),
    execute("git", ["-C", cwd, "--no-optional-locks", "status", "--porcelain", "-z", "--untracked-files=all"], { cwd, timeout: 2000 }),
  ]);
  if (head.code !== 0 || status.code !== 0) throw new Error("Workspace freshness unavailable");
  const hash = createHash("sha256").update(head.stdout).update(status.stdout);
  let latestDirtyMtime: number | undefined;
  for (const entry of status.stdout.split("\0").filter(Boolean)) {
    const path = /^[ MADRCU?!][ MADRCU?!] /.test(entry) ? entry.slice(3) : entry;
    try {
      const stat = statSync(join(cwd, path));
      hash.update(`${stat.mtimeMs}:${stat.size}`);
      latestDirtyMtime = Math.max(latestDirtyMtime ?? 0, stat.mtimeMs);
    }
    catch { hash.update("missing"); }
  }
  return { fingerprint: hash.digest("hex"), head: head.stdout.trim() || undefined, dirty: status.stdout.length > 0, latestDirtyMtime };
}

export interface IndexHealth { state: Health; reason?: string; lastSuccess?: number; version?: string }
const graphMetadata = new Map<string, { version: string; commit?: string }>();
const busy = /locked|SQLITE_BUSY|SQLITE_LOCKED|another process.*indexing/i;
const repair = /index format version mismatch|index is incomplete|SQLITE_CORRUPT|database disk image is malformed|could not load graph.*invalid JSON/i;

// Strictly read-only. Vera statistics are not proof that vector queries work:
// report unchecked until a vector query (including helper verification) succeeds.
export async function readIndexHealth(which: IndexBackend, cwd: string, execute: Execute, head?: string): Promise<IndexHealth> {
  const args = which === "codegraph" ? ["status", "--json", cwd]
    : which === "vera" ? ["--json", "stats"]
    : ["god-nodes", "--top", "1", "--json", "--graph", join(cwd, "graphify-out", "graph.json")];
  const result = await execute(which, args, { cwd, timeout: 2000 });
  if (result.code !== 0) {
    const detail = `${result.stderr}\n${result.stdout}`;
    if (repair.test(detail)) return { state: "repair", reason: `Incompatible or incomplete index; /code-intel-repair ${which}` };
    if (busy.test(detail)) return { state: "updating", reason: "Another index writer is active" };
    return { state: "unavailable", reason: "Read-only health check failed; retry or inspect the backend" };
  }
  let data: any;
  try { data = JSON.parse(result.stdout); }
  catch { return { state: "unavailable", reason: "Health check returned invalid JSON" }; }
  if (which === "codegraph") {
    if (data?.initialized !== true || typeof data.lastIndexed !== "string" || !data.lastIndexed || data.worktreeMismatch)
      return { state: "unavailable", reason: "No completed build for this workspace; /code-intel-repair codegraph" };
    const lastSuccess = Date.parse(data.lastIndexed);
    const version = data.lastIndexed;
    if (data.index?.reindexRecommended) return { state: "stale", reason: "Extractor upgrade recommends reindexing; /code-intel-repair codegraph", lastSuccess: Number.isFinite(lastSuccess) ? lastSuccess : undefined, version };
    if (Object.values(data.pendingChanges ?? {}).some((count) => typeof count === "number" && count > 0))
      return { state: "stale", reason: "Backend reports pending file changes", version };
    return { state: "ready", lastSuccess: Number.isFinite(lastSuccess) ? lastSuccess : undefined, version };
  }
  if (which === "vera") {
    if (!Number.isInteger(data?.file_count) || data.file_count < 0) return { state: "unavailable", reason: "Invalid index statistics" };
    return { state: "unchecked", reason: "Statistics readable; vector queries not yet verified" };
  }
  if (!Array.isArray(data) || data.length === 0) return { state: "unavailable", reason: "Graph is empty or unreadable; /code-intel-repair graphify" };
  const path = join(cwd, "graphify-out", "graph.json");
  const stat = statSync(path);
  const version = `${stat.mtimeMs}:${stat.size}`;
  if (head) {
    let metadata = graphMetadata.get(cwd);
    if (metadata?.version !== version) {
      const raw = await readFile(path, "utf8");
      metadata = { version, commit: /"built_at_commit"\s*:\s*"([0-9a-f]{7,40})"/.exec(raw)?.[1] };
      graphMetadata.set(cwd, metadata);
    }
    if (!metadata.commit) return { state: "unchecked", reason: "Graph readable; commit freshness metadata missing", version };
    if (!head.startsWith(metadata.commit)) return { state: "stale", reason: "Graph records a different Git commit; /code-intel-sync", lastSuccess: stat.mtimeMs, version };
  }
  return { state: "ready", lastSuccess: stat.mtimeMs, version };
}
