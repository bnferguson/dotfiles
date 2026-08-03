/**
 * telemetry — record what actually happened in a pi session.
 *
 * Generic on purpose: it hooks pi's own tool and turn events, so it sees
 * built-in tools, every extension's tools, and anything added later, without
 * knowing anything about them. Nothing here is code-intel specific.
 *
 * It exists because you cannot evaluate a change to an agent's tooling without
 * a record of what it did. "Did structural navigation help this refactor?" is
 * unanswerable from a transcript you have to read by eye, and completely
 * unanswerable across ten runs.
 *
 * What it records, one JSON object per line:
 *   session  cwd, git branch/commit, model, start/end, wall time
 *   tool     name, duration, ok/error, result size, turn index
 *   turn     index, duration, token usage
 *
 * What it deliberately does NOT record: tool inputs and outputs. Those are your
 * source code, prompts, and occasionally secrets, and this writes to disk
 * unencrypted. Sizes and names answer the evaluation questions; contents don't.
 * Set PI_TELEMETRY_VERBOSE=1 if you specifically need arguments captured.
 *
 * Logs land in ~/.pi/agent/telemetry/ rather than the project, so a repo never
 * gets polluted and cross-repo comparison is possible. `bin/pi-telemetry`
 * summarizes and compares them; `/stats` shows the current session.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const LOG_DIR = join(homedir(), ".pi", "agent", "telemetry");
const VERBOSE = process.env.PI_TELEMETRY_VERBOSE === "1";

interface ToolStat {
	calls: number;
	ms: number;
	errors: number;
	bytes: number;
}

export default function telemetryExtension(pi: ExtensionAPI): void {
	let logFile: string | undefined;
	let sessionId = "unknown";
	let sessionStart = Date.now();
	let turnIndex = 0;

	/** toolCallId -> start time. tool_result can interleave under parallel execution. */
	const started = new Map<string, { at: number; tool: string }>();
	const byTool = new Map<string, ToolStat>();
	let turns = 0;
	let tokensIn = 0;
	let tokensOut = 0;
	let tokensCacheRead = 0;
	let tokensTotal = 0;
	let costTotal = 0;

	function write(record: Record<string, unknown>): void {
		if (!logFile) return;
		try {
			appendFileSync(logFile, `${JSON.stringify({ t: new Date().toISOString(), ...record })}\n`);
		} catch {
			// Telemetry must never break a session. If the disk is full or the path
			// is unwritable, silently stop rather than throwing inside a hook.
		}
	}

	function stat(tool: string): ToolStat {
		let s = byTool.get(tool);
		if (!s) {
			s = { calls: 0, ms: 0, errors: 0, bytes: 0 };
			byTool.set(tool, s);
		}
		return s;
	}

	async function gitInfo(cwd: string): Promise<{ branch?: string; commit?: string }> {
		try {
			const r = await pi.exec("git", ["-C", cwd, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000 });
			const c = await pi.exec("git", ["-C", cwd, "rev-parse", "--short", "HEAD"], { timeout: 3000 });
			return { branch: r.stdout.trim() || undefined, commit: c.stdout.trim() || undefined };
		} catch {
			return {};
		}
	}

	pi.on("session_start", async (event, ctx) => {
		// Reset aggregates: /resume and /new reuse the process.
		started.clear();
		byTool.clear();
		turns = 0;
		tokensIn = 0;
		tokensOut = 0;
		tokensCacheRead = 0;
		tokensTotal = 0;
		costTotal = 0;
		turnIndex = 0;
		sessionStart = Date.now();

		const file = ctx.sessionManager.getSessionFile?.();
		sessionId = file ? basename(String(file)).replace(/\.jsonl?$/, "") : `ephemeral-${Date.now()}`;

		try {
			mkdirSync(LOG_DIR, { recursive: true });
			logFile = join(LOG_DIR, `${new Date().toISOString().slice(0, 10)}-${sessionId}.jsonl`);
		} catch {
			logFile = undefined;
		}

		const git = await gitInfo(ctx.cwd);
		write({
			ev: "session",
			reason: event.reason,
			session: sessionId,
			cwd: ctx.cwd,
			...git,
			model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : undefined,
			// The tool set is the independent variable in most experiments here,
			// so record it rather than trying to reconstruct it later.
			tools: pi.getActiveTools(),
		});
	});

	pi.on("tool_execution_start", async (event) => {
		started.set(event.toolCallId, { at: Date.now(), tool: event.toolName });
	});

	pi.on("tool_result", async (event) => {
		const s = started.get(event.toolCallId);
		started.delete(event.toolCallId);
		const ms = s ? Date.now() - s.at : 0;
		const tool = event.toolName ?? s?.tool ?? "unknown";

		const text = Array.isArray(event.content)
			? event.content.map((c) => (c as { text?: string }).text ?? "").join("")
			: "";

		const agg = stat(tool);
		agg.calls++;
		agg.ms += ms;
		agg.bytes += text.length;
		if (event.isError) agg.errors++;

		write({
			ev: "tool",
			session: sessionId,
			turn: turnIndex,
			tool,
			ms,
			ok: !event.isError,
			bytes: text.length,
			// An interception (code-intel's nudge, a permission gate) surfaces as an
			// error result. Keeping the first line makes those countable without
			// storing whole outputs.
			note: event.isError ? text.split("\n")[0]?.slice(0, 200) : undefined,
			input: VERBOSE ? event.input : undefined,
		});
	});

	pi.on("turn_start", async (event) => {
		turnIndex = (event as { turnIndex?: number }).turnIndex ?? turnIndex + 1;
	});

	pi.on("turn_end", async (event, ctx) => {
		turns++;
		// `input` alone is misleading under prompt caching — it counts only the
		// uncached remainder, so a turn reading 15k tokens of context can report
		// input: 2. Record the whole breakdown, and cost, which is what any
		// "is this approach cheaper" question actually needs.
		const usage = (
			event as {
				message?: {
					usage?: {
						input?: number;
						output?: number;
						cacheRead?: number;
						cacheWrite?: number;
						reasoning?: number;
						totalTokens?: number;
						cost?: { total?: number };
					};
				};
			}
		).message?.usage;

		const inTok = usage?.input ?? 0;
		const outTok = usage?.output ?? 0;
		const cacheRead = usage?.cacheRead ?? 0;
		const total = usage?.totalTokens ?? 0;
		const cost = usage?.cost?.total ?? 0;

		tokensIn += inTok;
		tokensOut += outTok;
		tokensCacheRead += cacheRead;
		tokensTotal += total;
		costTotal += cost;

		write({
			ev: "turn",
			session: sessionId,
			turn: turnIndex,
			tokensIn: inTok,
			tokensOut: outTok,
			cacheRead,
			cacheWrite: usage?.cacheWrite ?? 0,
			reasoning: usage?.reasoning,
			totalTokens: total,
			cost,
			contextTokens: ctx.getContextUsage?.()?.tokens,
		});
	});

	pi.on("session_shutdown", async () => {
		write({
			ev: "session_end",
			session: sessionId,
			wallMs: Date.now() - sessionStart,
			turns,
			tokensIn,
			tokensOut,
			cacheRead: tokensCacheRead,
			totalTokens: tokensTotal,
			cost: costTotal,
			tools: Object.fromEntries([...byTool].map(([k, v]) => [k, v])),
		});
	});

	function summary(ctx: ExtensionContext): string {
		if (byTool.size === 0) return "No tool calls recorded yet.";
		const rows = [...byTool].sort((a, b) => b[1].calls - a[1].calls);
		const width = Math.max(...rows.map(([n]) => n.length), 4);
		const lines = rows.map(
			([name, s]) =>
				`  ${name.padEnd(width)}  ${String(s.calls).padStart(4)} calls  ${String(Math.round(s.ms)).padStart(6)}ms  ` +
				`${String(s.errors).padStart(3)} err  ${String(Math.round(s.bytes / 1024)).padStart(5)}KB`,
		);
		const total = rows.reduce((a, [, s]) => a + s.calls, 0);
		return [
			`session ${sessionId}  (${((Date.now() - sessionStart) / 1000).toFixed(0)}s, ${turns} turns)`,
			`tokens: ${tokensTotal} total (${tokensIn} in / ${tokensOut} out / ${tokensCacheRead} cached)` +
				(costTotal > 0 ? `  — $${costTotal.toFixed(4)}` : ""),
			`tool calls: ${total}`,
			...lines,
			logFile ? `\nlog: ${logFile}` : "\n(not logging — telemetry dir unwritable)",
		].join("\n");
	}

	pi.registerCommand("stats", {
		description: "Show tool usage, timing, and token stats for this session",
		handler: async (_args, ctx) => ctx.ui.notify(summary(ctx), "info"),
	});
}
