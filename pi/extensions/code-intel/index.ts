/**
 * code-intel — structural code navigation as first-class pi tools.
 *
 * pi ships no MCP client (by design — see pi docs/usage.md), so codegraph's
 * MCP verbs are unreachable here. Every one of them has a CLI equivalent, so
 * this extension wraps them (plus vera and ast-grep) as native pi tools. That
 * lands them better than MCP would: they get promptSnippet/promptGuidelines
 * entries in the system prompt, so the model sees them next to `grep`.
 *
 * The point is the routing pressure, not just the tools. A Claude Code skill
 * can only *ask* the model to prefer the index; pi can enforce it:
 *
 *   off     tools registered, no pressure
 *   on      grep/find get one redirect to the structural equivalent, then
 *           pass through if the model still wants them (instructive default)
 *   strict  grep/find removed from the active tool set entirely — the model
 *           has no textual fallback. This is the measurement mode.
 *
 * Toggle with /code-intel, Ctrl+Alt+I, or --code-intel <mode>. Auto-enables
 * `on` when a repo already has .codegraph/ or .vera/.
 *
 * Index management stays in the `code-intel` shell helper (code-intel init |
 * refresh | warm | status) — this extension only consumes indexes.
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Key } from "@earendil-works/pi-tui";
import { Type } from "typebox";

type Mode = "off" | "on" | "strict";

const MODES: Mode[] = ["off", "on", "strict"];
const TEXT_TOOLS = ["grep", "find"];
const EXEC_TIMEOUT = 120_000;

/** Tools this extension registers, in the order they're advertised. */
const OWNED_TOOLS = [
	"cg_context",
	"cg_query",
	"cg_callers",
	"cg_callees",
	"cg_impact",
	"vera_search",
	"ast_search",
	"ast_rewrite",
	"gf_query",
	"gf_explain",
	"gf_affected",
	"gf_overview",
];

/**
 * How long a sync result is trusted before we bother re-checking. The dirty
 * check itself is ~0.1s (git) and a no-op sync is ~0.3-1s, so this only exists
 * to avoid re-syncing between sibling tool calls in one batch.
 */
const SYNC_DEBOUNCE_MS = 5_000;

/**
 * Budget for auto-syncing graphify before a gf_* call. Above this it stays
 * manual (`/code-intel-sync`) and the tool reports its staleness instead.
 */
const GRAPHIFY_AUTOSYNC_BUDGET_MS = 8_000;

/**
 * Conservative cost estimate for a graphify rebuild, used only until we've
 * timed a real one. graphify re-extracts the whole corpus every run — there is
 * no incremental path — so cost tracks corpus size, not the size of the change.
 * Measured 0.79 s/MB of graph.json on a small repo and 0.87 s/MB on a large one,
 * so 0.9 rounds up honestly.
 */
const GRAPHIFY_MS_PER_MB = 900;

function have(bin: string): boolean {
	// Cheap PATH probe — avoids paying for a subprocess per tool registration.
	const dirs = (process.env.PATH ?? "").split(":").filter(Boolean);
	return dirs.some((d) => existsSync(join(d, bin)));
}

export default function codeIntelExtension(pi: ExtensionAPI): void {
	let mode: Mode = "off";
	/** Tool set captured before strict mode pruned it, for restore on exit. */
	let toolsBeforeStrict: string[] | undefined;
	/**
	 * Redirect budget: each distinct text search is nudged once, then allowed.
	 * Session-scoped on purpose. An earlier version cleared this every turn, which
	 * silently broke the contract the block message advertises — the model's retry
	 * lands in a *new* turn, so it got blocked again on a call it was explicitly
	 * told would succeed. Never expire these within a session.
	 */
	const nudged = new Set<string>();

	const hasCodegraph = have("codegraph");
	const hasVera = have("vera");
	const hasAstGrep = have("ast-grep");
	const hasGraphify = have("graphify");

	pi.registerFlag("code-intel", {
		description: "Start in a code-intel mode: off | on | strict",
		type: "string",
		default: "",
	});

	// ------------------------------------------------------------ index sync

	/**
	 * Keeping the indexes fresh, measured rather than assumed (6000-file repo):
	 *
	 *   codegraph sync, no-op ......... 0.29s
	 *   vera update, no-op ............ 0.96s
	 *   vera update, one file changed . 0.47s
	 *   git ls-files -m -o ............ 0.10s
	 *
	 * All cheap enough to run inline before a query, so these tools sync
	 * themselves rather than serving stale answers. In Claude Code codegraph is
	 * kept fresh by the watcher in its MCP server — pi has no MCP, so nothing
	 * would sync it here at all if we didn't do it explicitly.
	 *
	 * The one genuine hazard is INTERRUPTION, not cost. A `vera update` killed
	 * mid-flight leaves its content-hash bookkeeping inconsistent, and the next
	 * update re-embeds everything it lost track of: measured at 1692 files /
	 * 19.5 minutes wall / 71 minutes CPU, from a single Ctrl+C. So sync never
	 * receives the tool's AbortSignal and is never killed on shutdown — a
	 * half-finished index is far more expensive than a slow one.
	 */
	const lastSync = new Map<string, number>();
	const inFlight = new Map<string, Promise<void>>();
	/** Measured wall time of the last completed sync, per key. Beats estimating. */
	const syncCostMs = new Map<string, number>();

	/** Cheap uncommitted-change probe. Empty result doesn't prove clean (a commit
	 * or branch switch also invalidates), so it only ever short-circuits work. */
	async function dirtyCount(cwd: string): Promise<number> {
		try {
			const r = await pi.exec("git", ["-C", cwd, "ls-files", "-m", "-o", "--exclude-standard"], { timeout: 5000 });
			return r.stdout.split("\n").filter(Boolean).length;
		} catch {
			return 0;
		}
	}

	async function sync(which: "codegraph" | "vera" | "graphify", cwd: string): Promise<void> {
		const key = `${which}:${cwd}`;
		const running = inFlight.get(key);
		if (running) return running;

		const last = lastSync.get(key) ?? 0;
		if (Date.now() - last < SYNC_DEBOUNCE_MS) return;

		const startedAt = Date.now();
		const job = (async () => {
			try {
				// Deliberately no `signal`: aborting mid-write is the expensive failure.
				if (which === "codegraph") await pi.exec("codegraph", ["sync", "-p", cwd], { timeout: 120_000 });
				else if (which === "graphify") await pi.exec("graphify", ["update", cwd], { timeout: 900_000 });
				else await pi.exec("vera", ["update", cwd], { timeout: 900_000 });
				syncCostMs.set(key, Date.now() - startedAt);
				lastSync.set(key, Date.now());
			} catch {
				// A failed sync shouldn't fail the query; the tool still answers, just
				// from a possibly older index.
			} finally {
				inFlight.delete(key);
			}
		})();
		inFlight.set(key, job);
		return job;
	}

	/** Called at the top of every index-backed tool. */
	async function freshen(which: "codegraph" | "vera", cwd: string): Promise<void> {
		const key = `${which}:${cwd}`;
		if (!lastSync.has(key) || (await dirtyCount(cwd)) > 0) await sync(which, cwd);
	}

	// ---------------------------------------------------------------- helpers

	/**
	 * Which indexes exist here, and which could. The three are complementary
	 * rather than alternatives — codegraph traverses, vera finds by meaning,
	 * graphify spans docs — so a project with only one is under-served, and the
	 * missing list is worth surfacing rather than quietly working around.
	 */
	function indexReport(cwd: string): { present: string[]; missing: string[] } {
		const all: [boolean, string, string][] = [
			[hasCodegraph, "codegraph", ".codegraph"],
			[hasVera, "vera", ".vera"],
			[hasGraphify, "graphify", join("graphify-out", "graph.json")],
		];
		const present: string[] = [];
		const missing: string[] = [];
		for (const [installed, name, marker] of all) {
			if (!installed) continue; // tool isn't on this machine; not a gap to nag about
			(existsSync(join(cwd, marker)) ? present : missing).push(name);
		}
		return { present, missing };
	}

	function indexedWith(ctx: { cwd: string }): string[] {
		return indexReport(ctx.cwd).present;
	}

	/**
	 * Run a CLI tool and hand its stdout to the LLM verbatim. Non-zero exits are
	 * thrown so pi flags the tool result as an error rather than feeding the
	 * model an empty success.
	 */
	async function run(bin: string, args: string[], signal?: AbortSignal, hint?: string) {
		const result = await pi.exec(bin, args, { signal, timeout: EXEC_TIMEOUT });
		if (result.code !== 0) {
			const detail = (result.stderr || result.stdout || "").trim();
			throw new Error(`${bin} ${args[0]} failed (exit ${result.code})${hint ? `\n${hint}` : ""}\n${detail}`);
		}
		const out = result.stdout.trim();
		return {
			content: [{ type: "text" as const, text: out || "(no results)" }],
			details: { command: `${bin} ${args.join(" ")}`, empty: out.length === 0 },
		};
	}

	/** codegraph and vera both need a per-project index; fail with the fix, not a stack trace. */
	function requireIndex(cwd: string, dir: string, tool: string): void {
		if (!existsSync(join(cwd, dir))) {
			throw new Error(
				`No ${dir}/ in ${cwd} — this project isn't indexed for ${tool}. Run \`code-intel init\` in the repo root, then retry. Until then, use grep/read.`,
			);
		}
	}

	// ------------------------------------------------------------ codegraph

	if (hasCodegraph) {
		pi.registerTool({
			name: "cg_context",
			label: "Graph Context",
			description:
				"Build task context from the structural code graph: entry points, related symbols, and relevant code blocks for a described task. Use this as the FIRST move on a new task in an indexed repo instead of grepping around for where to start.",
			promptSnippet: "Build starting context for a task from the code graph (entry points + related symbols)",
			promptGuidelines: [
				"Use cg_context as your opening move on any non-trivial task in a repo that has a .codegraph/ index, instead of guessing at file names with find or grep.",
			],
			parameters: Type.Object({
				task: Type.String({ description: "Natural-language description of the task or question" }),
				maxNodes: Type.Optional(Type.Number({ description: "Max graph nodes to include (default 50)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				requireIndex(ctx.cwd, ".codegraph", "codegraph");
				await freshen("codegraph", ctx.cwd);
				const args = ["context", params.task, "-p", ctx.cwd];
				if (params.maxNodes) args.push("-n", String(params.maxNodes));
				return run("codegraph", args, signal);
			},
		});

		pi.registerTool({
			name: "cg_query",
			label: "Graph Search",
			description:
				"Search the code graph for symbols by name or fragment, optionally filtered by kind (function, class, method, interface...). Returns declaration sites with file and line. Faster and more precise than grepping for a definition.",
			promptSnippet: "Find symbol declarations in the code graph by name or kind",
			promptGuidelines: [
				"Use cg_query to locate where a symbol is declared, rather than grepping for 'function name' or 'class name' patterns.",
			],
			parameters: Type.Object({
				search: Type.String({ description: "Symbol name or fragment" }),
				kind: Type.Optional(Type.String({ description: "Filter by node kind, e.g. function, class, method" })),
				limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				requireIndex(ctx.cwd, ".codegraph", "codegraph");
				await freshen("codegraph", ctx.cwd);
				const args = ["query", params.search, "-p", ctx.cwd];
				if (params.kind) args.push("-k", params.kind);
				if (params.limit) args.push("-l", String(params.limit));
				return run("codegraph", args, signal);
			},
		});

		for (const [name, verb, label, what] of [
			["cg_callers", "callers", "Callers", "every function or method that calls a symbol"],
			["cg_callees", "callees", "Callees", "every function or method that a symbol itself calls"],
		] as const) {
			pi.registerTool({
				name,
				label,
				description: `Find ${what}, from real call edges in the structural graph — not text matches. Use instead of grepping for the symbol name, which also hits comments, strings, unrelated same-named methods, and misses dynamic dispatch the graph resolves.`,
				promptSnippet: `Find ${what} via the code graph`,
				promptGuidelines: [
					`Use ${name} to trace call relationships instead of grepping for a symbol name — grep results conflate declarations, comments, and unrelated same-named symbols.`,
				],
				parameters: Type.Object({
					symbol: Type.String({ description: "Symbol name to trace" }),
					limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
				}),
				async execute(_id, params, signal, _onUpdate, ctx) {
					requireIndex(ctx.cwd, ".codegraph", "codegraph");
				await freshen("codegraph", ctx.cwd);
					const args = [verb, params.symbol, "-p", ctx.cwd];
					if (params.limit) args.push("-l", String(params.limit));
					return run("codegraph", args, signal);
				},
			});
		}

		pi.registerTool({
			name: "cg_impact",
			label: "Impact",
			description:
				"Analyze the blast radius of changing a symbol: everything transitively affected, to a given depth. Run this BEFORE renaming, changing a signature, or deleting anything — and before ast_rewrite.",
			promptSnippet: "Assess the blast radius of changing a symbol before editing it",
			promptGuidelines: [
				"Run cg_impact before any rename, signature change, or deletion in an indexed repo, and before running ast_rewrite, so the edit set is known up front rather than discovered through failing builds.",
			],
			parameters: Type.Object({
				symbol: Type.String({ description: "Symbol about to change" }),
				depth: Type.Optional(Type.Number({ description: "Traversal depth (default 2)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				requireIndex(ctx.cwd, ".codegraph", "codegraph");
				await freshen("codegraph", ctx.cwd);
				const args = ["impact", params.symbol, "-p", ctx.cwd];
				if (params.depth) args.push("-d", String(params.depth));
				return run("codegraph", args, signal);
			},
		});
	}

	// ----------------------------------------------------------------- vera

	if (hasVera) {
		pi.registerTool({
			name: "vera_search",
			label: "Semantic Search",
			description:
				"Semantic code search over the vera index — finds code by MEANING, so it works when you don't know the symbol name. Ask in natural language ('validates JWT expiry', 'where retries are backed off'). This is the only tool here that finds code you can't name.",
			promptSnippet: "Find code by meaning (natural language) rather than by exact text",
			promptGuidelines: [
				"Use vera_search when you don't know the exact identifier — describe the behavior in natural language. Reach for grep only when you know the literal string you want.",
			],
			parameters: Type.Object({
				query: Type.String({ description: "Natural-language description of the behavior to find" }),
				scope: Type.Optional(StringEnum(["source", "docs", "runtime"] as const)),
				lang: Type.Optional(Type.String({ description: "Filter by language, e.g. rust, typescript" })),
				limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				requireIndex(ctx.cwd, ".vera", "vera");
				await freshen("vera", ctx.cwd);
				const args = ["search", params.query];
				if (params.scope) args.push("--scope", params.scope);
				if (params.lang) args.push("--lang", params.lang);
				if (params.limit) args.push("--limit", String(params.limit));
				return run("vera", args, signal);
			},
		});
	}

	// -------------------------------------------------------------- ast-grep

	if (hasAstGrep) {
		pi.registerTool({
			name: "ast_search",
			label: "AST Search",
			description:
				"Structural search by AST pattern, using ast-grep. Patterns are written as code with $META variables: `$A.then($B)`, `if ($C) { return $D }`, `func $NAME($$$ARGS) error`. Matches syntax, so it ignores formatting, line breaks, and comments that defeat regex. Needs no index — works in any repo.",
			promptSnippet: "Search code by AST pattern (formatting-insensitive structural match)",
			promptGuidelines: [
				"Use ast_search instead of grep when the thing you're matching is a code shape rather than a literal string — call patterns, signatures, control-flow shapes. It is immune to line breaks and formatting that break regexes.",
			],
			parameters: Type.Object({
				pattern: Type.String({ description: "ast-grep pattern, e.g. `$A.then($B)` or `func $N($$$A) error`" }),
				lang: Type.Optional(Type.String({ description: "Language, e.g. ts, tsx, rust, go, python" })),
				path: Type.Optional(Type.String({ description: "Path to search (default: cwd)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["run", "-p", params.pattern];
				if (params.lang) args.push("-l", params.lang);
				args.push(params.path?.replace(/^@/, "") ?? ctx.cwd);
				return run("ast-grep", args, signal);
			},
		});

		pi.registerTool({
			name: "ast_rewrite",
			label: "AST Rewrite",
			description:
				"Structural find-and-replace across a codebase via ast-grep, reusing $META variables in the rewrite: pattern `$A.then($B)` → rewrite `await $A`. Previews a diff by default; pass apply:true to write. Use for mechanical multi-file refactors instead of many hand-written edit calls or sed.",
			promptSnippet: "Apply a structural find-and-replace refactor across files (diff preview by default)",
			promptGuidelines: [
				"Use ast_rewrite for mechanical refactors that touch many files — it is safer than sed and far cheaper than a long series of edit calls. Preview first (apply defaults to false), and run cg_impact beforehand when the change touches a symbol's contract.",
			],
			parameters: Type.Object({
				pattern: Type.String({ description: "ast-grep pattern to match" }),
				rewrite: Type.String({ description: "Replacement, reusing $META vars from the pattern" }),
				lang: Type.Optional(Type.String({ description: "Language, e.g. ts, tsx, rust, go, python" })),
				path: Type.Optional(Type.String({ description: "Path to rewrite (default: cwd)" })),
				apply: Type.Optional(Type.Boolean({ description: "Write changes. Default false = diff preview only." })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["run", "-p", params.pattern, "-r", params.rewrite];
				if (params.lang) args.push("-l", params.lang);
				// -U applies without prompting; without it ast-grep would block on a TTY it doesn't have.
				args.push(params.apply ? "-U" : "--json=compact");
				args.push(params.path?.replace(/^@/, "") ?? ctx.cwd);
				const res = await run("ast-grep", args, signal);
				if (!params.apply) {
					res.content.push({
						type: "text" as const,
						text: "\n(preview only — no files changed. Re-run with apply:true to write.)",
					});
				}
				return res;
			},
		});
	}

	// ------------------------------------------------------------- graphify

	/**
	 * graphify syncs adaptively, because unlike the others it has NO incremental
	 * path: every run re-extracts the whole corpus, so a no-op costs the same as
	 * a full rebuild and the price tracks repo size, not change size.
	 *
	 * Measured ~0.8 s/MB of graph.json, consistent across a 12x size range:
	 *   8.2MB graph  ->  2.2s   (cheap enough to hide behind a query)
	 *  55.1MB graph  -> 41.6s   (not remotely)
	 *
	 * So rebuildCostMs() decides per repo, and staleness is reported when we
	 * choose not to rebuild. graphify records `built_at_commit`, so that report
	 * is exact — commits behind HEAD — rather than the mtime guesswork the
	 * others need. `/code-intel-sync` always forces a refresh.
	 *
	 * The CLI rebuild covers more than graphify's own messaging suggests: it
	 * re-extracts markdown structure too (on these dotfiles, 7,032 -> 8,688 nodes
	 * and 1,352 -> 8,616 edges, community labels intact). What it does NOT do is
	 * the LLM pass — semantic extraction of papers/images, and naming new
	 * communities. That still needs `/graphify` in-agent with a model backend.
	 *
	 * (Note for future edits: a node's missing `_origin` field does NOT mean
	 * "LLM-extracted". It means an older extractor wrote it. Use `file_type`.)
	 */
	if (hasGraphify) {
		const graphPath = (cwd: string) => join(cwd, "graphify-out", "graph.json");

		function requireGraph(cwd: string): void {
			if (!existsSync(graphPath(cwd))) {
				throw new Error(
					`No graphify-out/graph.json in ${cwd}. Build it with \`/graphify .\` inside an agent session (full semantic graph), or \`graphify update .\` for a code-only AST graph.`,
				);
			}
		}

		/** Exact staleness via the commit the graph was built at. */
		async function staleness(cwd: string): Promise<string> {
			try {
				const raw = readFileSync(graphPath(cwd), "utf8");
				const m = /"built_at_commit"\s*:\s*"([0-9a-f]{7,40})"/.exec(raw);
				if (!m) return "";
				const r = await pi.exec("git", ["-C", cwd, "rev-list", `${m[1]}..HEAD`, "--count"], { timeout: 5000 });
				const behind = Number.parseInt(r.stdout.trim(), 10);
				if (!Number.isFinite(behind) || behind === 0) return "";
				return `\n\n[graph is ${behind} commit(s) behind HEAD. Structure and architecture rarely move that fast, so this is usually fine — but for anything added in those commits, prefer cg_* or lsp_*. Run /code-intel-sync to rebuild.]`;
			} catch (err) {
				// Staleness is advisory, so a failure here must not fail the query — but
				// it must not be invisible either. A missing import once made this
				// silently return "" on every call, so the note never appeared and the
				// tool looked like it was working.
				return `\n\n[staleness check failed: ${err instanceof Error ? err.message : String(err)}]`;
			}
		}

		/**
		 * Auto-sync only when a rebuild is cheap enough to hide behind a query.
		 * Measured steady-state: 2.2s on an 8MB graph, 41.6s on a 55MB one — the
		 * first is worth paying for silently, the second very much is not.
		 */
		function rebuildCostMs(cwd: string): number {
			const measured = syncCostMs.get(`graphify:${cwd}`);
			if (measured !== undefined) return measured;
			try {
				return (statSync(graphPath(cwd)).size / 1_000_000) * GRAPHIFY_MS_PER_MB;
			} catch {
				return Number.POSITIVE_INFINITY;
			}
		}

		async function graphRun(cwd: string, args: string[], signal?: AbortSignal) {
			requireGraph(cwd);
			if (rebuildCostMs(cwd) <= GRAPHIFY_AUTOSYNC_BUDGET_MS) await sync("graphify", cwd);
			const res = await run("graphify", args, signal);
			const note = await staleness(cwd);
			if (note) res.content.push({ type: "text" as const, text: note });
			return res;
		}

		pi.registerTool({
			name: "gf_query",
			label: "Graph Query",
			description:
				"Ask a question against the graphify knowledge graph, which spans code AND docs, ADRs, schemas, and design rationale. Use for architecture and 'why' questions that code alone can't answer — the other tools here only see code.",
			promptSnippet: "Ask an architecture/'why' question across code, docs, and design rationale",
			promptGuidelines: [
				"Use gf_query for architecture, design-intent, and cross-cutting 'why' questions — it is the only tool here that indexes prose and docs alongside code.",
			],
			parameters: Type.Object({
				question: Type.String({ description: "Natural-language question about the project" }),
				budget: Type.Optional(Type.Number({ description: "Max output tokens (default 2000)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["query", params.question, "--graph", graphPath(ctx.cwd)];
				if (params.budget) args.push("--budget", String(params.budget));
				return graphRun(ctx.cwd, args, signal);
			},
		});

		pi.registerTool({
			name: "gf_explain",
			label: "Graph Explain",
			description:
				"Plain-language explanation of one node in the knowledge graph and its neighbours — what it is, what it connects to, and which part of the system it belongs to.",
			promptSnippet: "Explain a component and its neighbours from the knowledge graph",
			parameters: Type.Object({
				node: Type.String({ description: "Node label, e.g. a component, file, or concept name" }),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				return graphRun(ctx.cwd, ["explain", params.node, "--graph", graphPath(ctx.cwd)], signal);
			},
		});

		pi.registerTool({
			name: "gf_affected",
			label: "Graph Affected",
			description:
				"Reverse-traverse the knowledge graph to find what depends on a node. Complements cg_impact: that one follows call edges in code, this one also reaches docs, configs, and schemas that reference the thing.",
			promptSnippet: "Find what depends on a component, including docs and config",
			parameters: Type.Object({
				node: Type.String({ description: "Node label to trace backwards from" }),
				depth: Type.Optional(Type.Number({ description: "Reverse traversal depth (default 2)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["affected", params.node, "--graph", graphPath(ctx.cwd)];
				if (params.depth) args.push("--depth", String(params.depth));
				return graphRun(ctx.cwd, args, signal);
			},
		});

		pi.registerTool({
			name: "gf_overview",
			label: "Graph Overview",
			description:
				"List the most connected nodes in the knowledge graph — the architectural hubs. A fast way to orient in an unfamiliar project before reading any code.",
			promptSnippet: "List the architectural hubs of the project",
			promptGuidelines: [
				"Use gf_overview to orient in an unfamiliar repo before reading files, when a graphify-out/ graph exists.",
			],
			parameters: Type.Object({
				top: Type.Optional(Type.Number({ description: "How many hubs to show (default 10)" })),
			}),
			async execute(_id, params, signal, _onUpdate, ctx) {
				const args = ["god-nodes", "--graph", graphPath(ctx.cwd), "--json"];
				if (params.top) args.push("--top", String(params.top));
				const res = await graphRun(ctx.cwd, args, signal);

				// The plain-text output is label-only, which is useless on a docs-heavy
				// repo: the top hubs come back as three identical "Builtin Functions"
				// (three Zig reference versions) or 209 copies of "Problem". Resolve each
				// id to its source file so same-named nodes are distinguishable.
				try {
					const hubs = JSON.parse(res.content[0].text) as { id: string; label: string; degree: number }[];
					const graph = JSON.parse(readFileSync(graphPath(ctx.cwd), "utf8")) as {
						nodes: { id: string; source_file?: string }[];
					};
					const src = new Map(graph.nodes.map((n) => [n.id, n.source_file ?? ""]));
					res.content[0] = {
						type: "text" as const,
						text: [
							"Most connected nodes (architectural hubs):",
							...hubs.map((h, i) => {
								const f = src.get(h.id);
								return `${String(i + 1).padStart(2)}. ${h.label} — ${h.degree} edges${f ? `  [${f}]` : ""}`;
							}),
						].join("\n"),
					};
				} catch {
					// Enrichment is a nicety; the raw JSON is still a usable answer.
				}
				return res;
			},
		});
	}

	// ----------------------------------------------------------------- mode

	function applyStrict(): void {
		if (toolsBeforeStrict === undefined) toolsBeforeStrict = pi.getActiveTools();
		pi.setActiveTools(toolsBeforeStrict.filter((t) => !TEXT_TOOLS.includes(t)));
	}


	function releaseStrict(): void {
		if (toolsBeforeStrict === undefined) return;
		pi.setActiveTools(toolsBeforeStrict);
		toolsBeforeStrict = undefined;
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (mode === "off") {
			ctx.ui.setStatus("code-intel", undefined);
			return;
		}
		const color = mode === "strict" ? "warning" : "accent";
		const label = mode === "strict" ? "◆ structural (strict)" : "◆ structural";
		ctx.ui.setStatus("code-intel", ctx.ui.theme.fg(color, label));
	}

	function setMode(next: Mode, ctx: ExtensionContext, quiet = false): void {
		mode = next;
		nudged.clear();
		if (next === "strict") applyStrict();
		else releaseStrict();
		updateStatus(ctx);
		if (!quiet) {
			const msg =
				next === "off"
					? "code-intel: off — grep/find unrestricted."
					: next === "on"
						? "code-intel: on — grep/find redirected to structural tools once per pattern."
						: "code-intel: strict — grep/find removed from the tool set.";
			ctx.ui.notify(msg, next === "strict" ? "warning" : "info");
		}
		pi.appendEntry("code-intel", { mode, toolsBeforeStrict });
	}

	function cycle(ctx: ExtensionContext): void {
		setMode(MODES[(MODES.indexOf(mode) + 1) % MODES.length], ctx);
	}

	pi.registerCommand("code-intel", {
		description: "Structural code navigation mode: off | on | strict (no arg cycles)",
		handler: async (args, ctx) => {
			const arg = args.trim().toLowerCase();
			if (arg === "status" || arg === "?") {
				const available = OWNED_TOOLS.filter((t) => pi.getActiveTools().includes(t));
				const { present, missing } = indexReport(ctx.cwd);
				ctx.ui.notify(
					[
						`mode: ${mode}`,
						`indexed:     ${present.length ? present.join(", ") : "none — run `code-intel init`"}`,
						missing.length ? `not indexed: ${missing.join(", ")} (\`code-intel init\` builds all three)` : "",
						`tools: ${available.length ? available.join(", ") : "none registered"}`,
					]
						.filter(Boolean)
						.join("\n"),
					"info",
				);
				return;
			}
			if (!arg) return cycle(ctx);
			if (!MODES.includes(arg as Mode)) {
				ctx.ui.notify(`Unknown mode '${arg}'. Use: off | on | strict | status`, "error");
				return;
			}
			setMode(arg as Mode, ctx);
		},
	});

	pi.registerShortcut(Key.ctrlAlt("i"), {
		description: "Cycle code-intel mode (off → on → strict)",
		handler: async (ctx) => cycle(ctx),
	});

	pi.registerCommand("code-intel-sync", {
		description: "Force an index sync now (codegraph + vera)",
		handler: async (_args, ctx) => {
			const idx = indexedWith(ctx);
			if (idx.length === 0) {
				ctx.ui.notify("No indexes here — run `code-intel init` first.", "info");
				return;
			}
			ctx.ui.setStatus("code-intel-sync", ctx.ui.theme.fg("muted", "↻ syncing"));
			for (const which of idx as ("codegraph" | "vera" | "graphify")[]) {
				lastSync.delete(`${which}:${ctx.cwd}`);
				await sync(which, ctx.cwd);
			}
			ctx.ui.setStatus("code-intel-sync", undefined);
			ctx.ui.notify(`Synced: ${idx.join(", ")}`, "info");
		},
	});

	// Never abandon an in-flight index write. Killing `vera update` partway is
	// the one genuinely expensive mistake available here (measured: a single
	// interrupted run cost 19.5 minutes to reconcile), so shutdown waits it out.
	pi.on("session_shutdown", async () => {
		if (inFlight.size === 0) return;
		await Promise.allSettled([...inFlight.values()]);
	});

	// Auto-enable where it pays off: a repo that's already indexed. Explicit
	// --code-intel always wins over detection.
	pi.on("session_start", async (_event, ctx) => {
		const flag = String(pi.getFlag("code-intel") ?? "").toLowerCase();
		if (MODES.includes(flag as Mode)) {
			setMode(flag as Mode, ctx, true);
			return;
		}

		const { present, missing } = indexReport(ctx.cwd);
		if (present.length === 0) return;

		// Announce rather than enable silently. Auto-enable changes how tool calls
		// behave, and an unannounced behaviour change is the same failure mode as a
		// stale index answering confidently: correct-looking, but not what you
		// think is happening.
		setMode("on", ctx, true);
		ctx.ui.notify(
			[
				`code-intel: on — ${present.join(", ")} indexed here.`,
				missing.length
					? `Not indexed: ${missing.join(", ")}. They answer different questions; \`code-intel init\` builds the full set.`
					: "",
				"Text searches get one redirect to a structural tool. /code-intel to change mode.",
			]
				.filter(Boolean)
				.join("\n"),
			"info",
		);
	});

	/**
	 * Suggest only tools that will actually work right here. Recommending
	 * cg_query in a repo with no .codegraph/ sends the model down a dead end and
	 * teaches it the whole mode is noise — observed doing exactly that.
	 */
	function alternativesFor(cwd: string): string[] {
		const out: string[] = [];
		const idx = indexedWith({ cwd });
		if (idx.includes("codegraph")) {
			out.push("cg_query to find a declaration, cg_callers/cg_callees to trace calls, cg_impact for blast radius");
		}
		if (idx.includes("vera")) {
			out.push("vera_search to find code by meaning when you don't know the identifier");
		}
		if (idx.includes("graphify")) {
			out.push("gf_query for architecture and 'why' questions spanning code and docs");
		}
		// These need no index, so they are always honest suggestions.
		out.push("lsp_references / lsp_definition for exact, type-aware symbol resolution (no index needed)");
		if (hasAstGrep) out.push("ast_search to match a code shape rather than a literal string (no index needed)");
		return out;
	}

	function nudgeFor(kind: string, key: string, cwd: string): { block: true; reason: string } | undefined {
		if (nudged.has(key)) return undefined;
		nudged.add(key);
		return {
			block: true,
			reason: [
				`code-intel mode: this ${kind} was intercepted once. Consider a structural tool first:`,
				...alternativesFor(cwd).map((a) => `  - ${a}`),
				"",
				`If ${kind} really is right here (literal string, config file, comment, non-code text), issue the exact same call again — it will not be intercepted a second time.`,
			].join("\n"),
		};
	}

	// Text search via the dedicated tools.
	pi.on("tool_call", async (event, ctx) => {
		if (mode === "off") return;

		// Strict mode removes grep/find from the tool set, but bash can still run
		// `grep -rn`. Close that hole outright, or "strict" measures nothing.
		if (mode === "strict" && event.toolName === "bash") {
			const command = String((event.input as { command?: string }).command ?? "");
			if (/(^|[|;&]|\$\()\s*(sudo\s+)?(grep|egrep|fgrep|rg|ag|ack)\b/.test(command)) {
				return {
					block: true,
					reason: [
						"code-intel strict mode: text search is disabled, including via bash. Use a structural tool:",
						...alternativesFor(ctx.cwd).map((a) => `  - ${a}`),
						"",
						"Run /code-intel on to leave strict mode if text search is genuinely required.",
					].join("\n"),
				};
			}
		}
		if (mode !== "on") return;

		if (TEXT_TOOLS.includes(event.toolName)) {
			return nudgeFor(event.toolName, `${event.toolName}:${JSON.stringify(event.input)}`, ctx.cwd);
		}

		// ...and the back door. Blocking the grep tool while leaving bash open just
		// teaches the model to run `grep -rn` in a shell instead, which is strictly
		// worse: same text search, but now invisible to this mode. Observed on the
		// very first run.
		if (event.toolName === "bash") {
			const command = String((event.input as { command?: string }).command ?? "");
			// Match only when a search binary is the command being run — at the start,
			// or after a pipe/separator — so `foo --grep` or `ripgrep_notes.md` don't trip it.
			// Backtick command substitution is deliberately NOT matched: it fires on any
			// command whose text merely quotes `grep` (a commit message, a heredoc, a doc
			// edit), which in this repo is constant. $(...) still covers real substitution.
			if (/(^|[|;&]|\$\()\s*(sudo\s+)?(grep|egrep|fgrep|rg|ag|ack)\b/.test(command)) {
				return nudgeFor("shell text search", `bash:${command}`, ctx.cwd);
			}
		}
	});
}
