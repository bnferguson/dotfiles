/**
 * lsp — compiler-accurate code navigation as pi tools.
 *
 * This is the index-free layer of the structural stack. vera/codegraph/graphify
 * all need a built index and go stale between refreshes; a language server
 * reads the same source of truth the compiler does, in any repo, with zero
 * setup beyond having the server on PATH. Different tradeoff, not a duplicate:
 *
 *   codegraph   whole-repo call graph, fast, approximate, needs .codegraph/
 *   lsp         exact within a project, type-aware, no index, slower to warm
 *   ast-grep    syntax shapes, no semantics, instant
 *   vera        meaning, when you can't name the thing
 *
 * Design note — the real problem here is addressing. LSP is positional
 * (file, line, character); an LLM has no idea what column a symbol sits in and
 * will hallucinate one. So every tool below takes a SYMBOL NAME plus a file,
 * and resolves the position internally via documentSymbol (falling back to a
 * word-boundary text scan). That single choice is what makes LSP usable to a
 * model at all — a positional API would be worse than grep in practice.
 *
 * Servers are spawned lazily per (language, project root), kept warm for the
 * session, and torn down on shutdown. Warmup matters: rust-analyzer and gopls
 * can take a minute to index, so requests retry while the server reports work
 * in progress rather than returning a confidently empty answer.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as rpc from "vscode-jsonrpc/node";

// --------------------------------------------------------------- server table

interface ServerSpec {
	id: string;
	cmd: string;
	args: string[];
	exts: string[];
	/** Files/dirs that mark a project root, most specific first. */
	roots: string[];
	/** Per-server initializationOptions, computed once the project root is known. */
	initOptions?: (root: string) => Record<string, unknown>;
}

/**
 * Only servers that are actually useful headless. Deliberately no linters-as-LSP
 * (eslint, etc.) — diagnostics from those are better obtained from their CLI.
 */
const SERVERS: ServerSpec[] = [
	{
		id: "typescript",
		cmd: "typescript-language-server",
		args: ["--stdio"],
		exts: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
		roots: ["tsconfig.json", "jsconfig.json", "package.json", ".git"],
		// typescript-language-server refuses to start without a tsserver to drive,
		// and plenty of repos (scripts, configs, fresh checkouts) have no local
		// typescript. Point it at one explicitly instead of failing to initialize.
		initOptions: (root) => {
			const lib = tsLibDir(root);
			return lib ? { tsserver: { path: join(lib, "tsserver.js") } } : {};
		},
	},
	{
		id: "rust",
		cmd: "rust-analyzer",
		args: [],
		exts: [".rs"],
		roots: ["Cargo.toml", ".git"],
	},
	{
		id: "go",
		cmd: "gopls",
		args: [],
		exts: [".go"],
		roots: ["go.mod", ".git"],
	},
	{
		id: "python",
		cmd: "pyright-langserver",
		args: ["--stdio"],
		exts: [".py", ".pyi"],
		roots: ["pyproject.toml", "setup.py", "setup.cfg", ".git"],
	},
	{
		id: "lua",
		cmd: "lua-language-server",
		args: [],
		exts: [".lua"],
		roots: [".luarc.json", "stylua.toml", ".git"],
	},
	{
		id: "c",
		cmd: "clangd",
		args: ["--background-index"],
		exts: [".c", ".h", ".cc", ".cpp", ".hpp", ".m", ".mm"],
		roots: ["compile_commands.json", "CMakeLists.txt", ".git"],
	},
	{
		id: "ruby",
		cmd: "ruby-lsp",
		args: [],
		exts: [".rb", ".rake"],
		roots: ["Gemfile", ".git"],
	},
	{
		id: "terraform",
		cmd: "terraform-ls",
		args: ["serve"],
		exts: [".tf", ".tfvars"],
		roots: [".terraform", ".git"],
	},
	{
		id: "zig",
		cmd: "zls",
		args: [],
		exts: [".zig"],
		roots: ["build.zig", ".git"],
	},
];

/** Mason installs servers outside PATH; nvim already manages them, so reuse them. */
const EXTRA_BIN_DIRS = [join(process.env.HOME ?? "", ".local/share/nvim/mason/bin")];

function which(cmd: string): string | undefined {
	const dirs = [...(process.env.PATH ?? "").split(":"), ...EXTRA_BIN_DIRS].filter(Boolean);
	for (const d of dirs) {
		const p = join(d, cmd);
		if (existsSync(p)) return p;
	}
	return undefined;
}

/**
 * Locate a TypeScript `lib/` directory. The workspace copy wins when present —
 * a project pinned to an older TS must be analyzed by that TS, not by whatever
 * is newest on the machine. Otherwise follow `tsc` on PATH, which symlinks into
 * the install's own `bin/`, so its realpath lands two levels under `lib/`.
 */
function tsLibDir(root: string): string | undefined {
	const local = join(root, "node_modules", "typescript", "lib");
	if (existsSync(join(local, "tsserver.js"))) return local;

	const tsc = which("tsc");
	if (tsc) {
		try {
			const lib = resolve(dirname(realpathSync(tsc)), "..", "lib");
			if (existsSync(join(lib, "tsserver.js"))) return lib;
		} catch {}
	}
	return undefined;
}

function specFor(file: string): ServerSpec | undefined {
	const ext = extname(file).toLowerCase();
	return SERVERS.find((s) => s.exts.includes(ext) && which(s.cmd));
}

function findRoot(file: string, spec: ServerSpec, fallback: string): string {
	for (const marker of spec.roots) {
		let dir = dirname(file);
		while (true) {
			if (existsSync(join(dir, marker))) return dir;
			const up = dirname(dir);
			if (up === dir) break;
			dir = up;
		}
	}
	return fallback;
}

// ------------------------------------------------------------- LSP connection

interface OpenDoc {
	version: number;
	/** Exact text last sent to the server, for change detection. */
	text: string;
}

interface Session {
	conn: rpc.MessageConnection;
	proc: ChildProcess;
	root: string;
	opened: Map<string, OpenDoc>;
	/** Count of in-flight server-reported work items (indexing, cargo check...). */
	busy: number;
	/** Set once project-wide results have been observed to stabilize. */
	warm: boolean;
	ready: Promise<void>;
}

const LSP_CAPABILITIES = {
	textDocument: {
		synchronization: { didSave: true, dynamicRegistration: false },
		definition: { linkSupport: false },
		references: {},
		hover: { contentFormat: ["plaintext", "markdown"] },
		rename: { prepareSupport: false },
		documentSymbol: { hierarchicalDocumentSymbolSupport: true },
		publishDiagnostics: {},
		implementation: { linkSupport: false },
		typeDefinition: { linkSupport: false },
	},
	workspace: {
		workspaceFolders: true,
		symbol: {},
		configuration: true,
	},
	window: { workDoneProgress: true },
};

export default function lspExtension(pi: ExtensionAPI): void {
	const sessions = new Map<string, Session>();
	/** Latest diagnostics per file URI, pushed by servers asynchronously. */
	const diagnostics = new Map<string, unknown[]>();

	async function getSession(spec: ServerSpec, root: string): Promise<Session> {
		const key = `${spec.id}:${root}`;
		const existing = sessions.get(key);
		if (existing) return existing;

		const bin = which(spec.cmd);
		if (!bin) throw new Error(`Language server '${spec.cmd}' not found on PATH.`);

		const proc = spawn(bin, spec.args, { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
		proc.stderr?.resume(); // drain, or a chatty server fills the pipe and blocks

		const conn = rpc.createMessageConnection(
			new rpc.StreamMessageReader(proc.stdout!),
			new rpc.StreamMessageWriter(proc.stdin!),
		);

		const session: Session = { conn, proc, root, opened: new Map(), busy: 0, warm: false, ready: Promise.resolve() };

		// Servers hang forever if these go unanswered — respond to all of them.
		conn.onRequest("workspace/configuration", (p: { items: unknown[] }) => p.items.map(() => ({})));
		conn.onRequest("client/registerCapability", () => null);
		conn.onRequest("client/unregisterCapability", () => null);
		conn.onRequest("window/workDoneProgress/create", () => null);
		conn.onRequest("workspace/applyEdit", () => ({ applied: false }));

		// Track indexing so queries can wait rather than return a false empty.
		conn.onNotification("$/progress", (p: { value?: { kind?: string } }) => {
			if (p.value?.kind === "begin") session.busy++;
			else if (p.value?.kind === "end") session.busy = Math.max(0, session.busy - 1);
		});
		conn.onNotification("textDocument/publishDiagnostics", (p: { uri: string; diagnostics: unknown[] }) => {
			diagnostics.set(p.uri, p.diagnostics);
		});
		conn.onNotification("window/logMessage", () => {});
		conn.onNotification("window/showMessage", () => {});

		conn.listen();

		const rootUri = pathToFileURL(root).toString();
		await conn.sendRequest("initialize", {
			processId: process.pid,
			rootUri,
			rootPath: root,
			capabilities: LSP_CAPABILITIES,
			workspaceFolders: [{ uri: rootUri, name: root }],
			initializationOptions: spec.initOptions?.(root) ?? {},
		});
		conn.sendNotification("initialized", {});

		sessions.set(key, session);
		return session;
	}

	function langId(file: string): string {
		const ext = extname(file).toLowerCase();
		const map: Record<string, string> = {
			".ts": "typescript", ".tsx": "typescriptreact", ".mts": "typescript", ".cts": "typescript",
			".js": "javascript", ".jsx": "javascriptreact", ".mjs": "javascript", ".cjs": "javascript",
			".rs": "rust", ".go": "go", ".py": "python", ".pyi": "python", ".lua": "lua",
			".rb": "ruby", ".rake": "ruby", ".tf": "terraform", ".tfvars": "terraform", ".zig": "zig",
			".c": "c", ".h": "c", ".cc": "cpp", ".cpp": "cpp", ".hpp": "cpp", ".m": "objective-c", ".mm": "objective-cpp",
		};
		return map[ext] ?? "plaintext";
	}

	/**
	 * Ensure the server's view of a file matches what's on disk.
	 *
	 * Critical: once a document is didOpen'd, the server treats ITS copy as
	 * authoritative and ignores the file on disk entirely. An agent that opens a
	 * file, then edits it, then queries again gets answers about the pre-edit
	 * text — silently, with no error. That is the single nastiest failure mode
	 * here, and it is guaranteed to happen mid-refactor. So re-read on every
	 * access and push a didChange whenever the bytes differ.
	 *
	 * Full-text sync rather than incremental: we don't have the edit deltas (the
	 * edits came from pi's tools, or a formatter, or the user's editor), and every
	 * server supports full sync.
	 */
	function openDoc(session: Session, file: string): string {
		const uri = pathToFileURL(file).toString();
		const text = readFileSync(file, "utf8");
		const prev = session.opened.get(uri);

		if (!prev) {
			session.conn.sendNotification("textDocument/didOpen", {
				textDocument: { uri, languageId: langId(file), version: 1, text },
			});
			session.opened.set(uri, { version: 1, text });
		} else if (prev.text !== text) {
			const version = prev.version + 1;
			session.conn.sendNotification("textDocument/didChange", {
				textDocument: { uri, version },
				contentChanges: [{ text }],
			});
			session.opened.set(uri, { version, text });
			// Diagnostics for the old text are now meaningless.
			diagnostics.delete(uri);
		}
		return uri;
	}

	/**
	 * Refresh every open document in every session. Cheap (a read + compare per
	 * file) and it covers edits the extension never saw — bash `sed`, a formatter,
	 * a rebase, the user's own editor. Called before each tool runs.
	 */
	function refreshAll(): void {
		for (const session of sessions.values()) {
			for (const uri of [...session.opened.keys()]) {
				try {
					const f = fileURLToPath(uri);
					if (existsSync(f)) openDoc(session, f);
				} catch {}
			}
		}
	}

	/**
	 * Wait for a project-wide answer to stop changing before trusting it.
	 *
	 * Servers answer *immediately* and *incompletely* while still loading the
	 * project, and there is no reliable signal for it. Measured on a 635-file
	 * Next.js app: `textDocument/references` for a symbol with 16 real references
	 * returned 1 (the declaration alone) at 0.3s and the full 16 from 3.4s
	 * onwards. Nothing distinguishes the wrong answer from the right one — no
	 * error, no partial-result flag — and for references specifically, an answer
	 * that is too small is exactly what silently breaks a refactor.
	 *
	 * `$/progress` doesn't save us: typescript-language-server never emits it, so
	 * gating on `busy` (as this used to) meant never waiting at all. Instead poll
	 * until two consecutive identical results, once per session — subsequent
	 * queries then answer at full speed. `busy` is still honoured for the servers
	 * that do report it (rust-analyzer, gopls), which take far longer to index.
	 */
	async function settled<T>(session: Session, fn: () => Promise<T>, fingerprint: (r: T) => string): Promise<T> {
		let result = await fn();
		if (session.warm) return result;

		const deadline = Date.now() + 60_000;
		while (Date.now() < deadline) {
			await new Promise((r) => setTimeout(r, 1000));
			const next = await fn();
			if (session.busy === 0 && fingerprint(next) === fingerprint(result)) {
				session.warm = true;
				return next;
			}
			result = next;
		}
		session.warm = true;
		return result;
	}

	const locationFingerprint = (r: unknown): string => {
		const list = Array.isArray(r) ? r : r ? [r] : [];
		return String(list.length);
	};

	interface Resolved { session: Session; uri: string; file: string; line: number; character: number }

	/**
	 * Resolve a symbol name to a concrete position — the crux of the whole
	 * extension. Prefer the server's own symbol table; fall back to a
	 * word-boundary scan so it still works for locals and for servers with weak
	 * documentSymbol support.
	 */
	async function locate(cwd: string, path: string, symbol: string): Promise<Resolved> {
		const file = isAbsolute(path) ? path : resolve(cwd, path.replace(/^@/, ""));
		if (!existsSync(file)) throw new Error(`No such file: ${file}`);

		const spec = specFor(file);
		if (!spec) {
			const known = SERVERS.filter((s) => which(s.cmd)).map((s) => s.id).join(", ");
			throw new Error(
				`No language server available for ${extname(file) || "this file"}. Servers present: ${known || "none"}.`,
			);
		}

		const session = await getSession(spec, findRoot(file, spec, cwd));
		refreshAll();
		const uri = openDoc(session, file);

		// 1. Ask the server where its symbols are.
		try {
			const syms = await session.conn.sendRequest("textDocument/documentSymbol", { textDocument: { uri } });
			const hit = findSymbol(syms as SymbolNode[], symbol);
			if (hit) return { session, uri, file, ...hit };
		} catch {
			// server doesn't support documentSymbol — fall through
		}

		// 2. Text scan for the identifier as a whole word.
		const lines = readFileSync(file, "utf8").split("\n");
		const re = new RegExp(`\\b${symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
		for (let i = 0; i < lines.length; i++) {
			const m = re.exec(lines[i]);
			if (m) return { session, uri, file, line: i, character: m.index };
		}

		throw new Error(`Symbol '${symbol}' not found in ${relative(cwd, file)}.`);
	}

	interface SymbolNode {
		name: string;
		children?: SymbolNode[];
		selectionRange?: { start: { line: number; character: number } };
		range?: { start: { line: number; character: number } };
		location?: { range: { start: { line: number; character: number } } };
	}

	function findSymbol(nodes: SymbolNode[] | null, name: string): { line: number; character: number } | undefined {
		for (const n of nodes ?? []) {
			if (n.name === name) {
				const start = (n.selectionRange ?? n.range ?? n.location?.range)?.start;
				if (start) return { line: start.line, character: start.character };
			}
			const child = findSymbol(n.children ?? null, name);
			if (child) return child;
		}
		return undefined;
	}

	// ---------------------------------------------------------------- output

	interface Loc { uri: string; range: { start: { line: number; character: number } } }

	function fmtLocations(cwd: string, locs: Loc | Loc[] | null): string {
		const list = (Array.isArray(locs) ? locs : locs ? [locs] : []).filter(Boolean);
		if (list.length === 0) return "(no results)";
		return list
			.map((l) => {
				const f = fileURLToPath((l as Loc).uri ?? (l as unknown as { targetUri: string }).targetUri);
				const r = (l as Loc).range ?? (l as unknown as { targetSelectionRange: Loc["range"] }).targetSelectionRange;
				const line = r.start.line;
				let text = "";
				try {
					text = readFileSync(f, "utf8").split("\n")[line]?.trim() ?? "";
				} catch {}
				return `${relative(cwd, f)}:${line + 1}:${r.start.character + 1}${text ? `  ${text}` : ""}`;
			})
			.join("\n");
	}

	const ok = (text: string, details: Record<string, unknown> = {}) => ({
		content: [{ type: "text" as const, text: text || "(no results)" }],
		details,
	});

	const symbolParams = {
		path: Type.String({ description: "File containing the symbol, relative to cwd" }),
		symbol: Type.String({ description: "Symbol name, e.g. `handleRequest` — not a line number" }),
	};

	// ----------------------------------------------------------------- tools

	pi.registerTool({
		name: "lsp_definition",
		label: "Definition",
		description:
			"Jump to where a symbol is defined, resolved by the language server — exact, type-aware, and correct across imports, re-exports, and overloads. Give a file and a symbol NAME (no line numbers). Works in any repo with no index.",
		promptSnippet: "Find a symbol's true definition via the language server",
		promptGuidelines: [
			"Use lsp_definition instead of grepping for a declaration — it resolves imports, re-exports, and same-named symbols correctly, which text search cannot.",
		],
		parameters: Type.Object(symbolParams),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const at = await locate(ctx.cwd, params.path, params.symbol);
			const res = await settled(
				at.session,
				() =>
					at.session.conn.sendRequest("textDocument/definition", {
						textDocument: { uri: at.uri },
						position: { line: at.line, character: at.character },
					}) as Promise<Loc[]>,
				locationFingerprint,
			);
			return ok(fmtLocations(ctx.cwd, res));
		},
	});

	pi.registerTool({
		name: "lsp_references",
		label: "References",
		description:
			"Find every real reference to a symbol across the project, resolved semantically by the language server. Unlike grep this excludes comments, strings, and unrelated same-named symbols, and includes references that don't textually match (aliased imports, re-exports). The correct tool for 'what breaks if I change this'.",
		promptSnippet: "Find all semantic references to a symbol via the language server",
		promptGuidelines: [
			"Use lsp_references rather than grep to enumerate usages before changing a symbol — grep both over- and under-reports, and the difference is where refactor bugs come from.",
		],
		parameters: Type.Object({
			...symbolParams,
			includeDeclaration: Type.Optional(Type.Boolean({ description: "Include the declaration itself (default false)" })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const at = await locate(ctx.cwd, params.path, params.symbol);
			const res = await settled(
				at.session,
				() =>
					at.session.conn.sendRequest("textDocument/references", {
						textDocument: { uri: at.uri },
						position: { line: at.line, character: at.character },
						context: { includeDeclaration: params.includeDeclaration ?? false },
					}) as Promise<Loc[]>,
				locationFingerprint,
			);
			const out = fmtLocations(ctx.cwd, res);
			const n = Array.isArray(res) ? res.length : 0;
			return ok(n ? `${n} reference(s):\n${out}` : out);
		},
	});

	pi.registerTool({
		name: "lsp_hover",
		label: "Hover",
		description:
			"Get the resolved type signature and doc comment for a symbol. Answers 'what type is this actually' including inferred and generic-instantiated types that appear nowhere in the source text.",
		promptSnippet: "Get a symbol's resolved type signature and docs",
		promptGuidelines: [
			"Use lsp_hover to learn a symbol's real (often inferred) type instead of reading the file and guessing at the annotation.",
		],
		parameters: Type.Object(symbolParams),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const at = await locate(ctx.cwd, params.path, params.symbol);
			const res = (await at.session.conn.sendRequest("textDocument/hover", {
				textDocument: { uri: at.uri },
				position: { line: at.line, character: at.character },
			})) as { contents?: unknown } | null;

			const c = res?.contents as { value?: string } | { value?: string }[] | string | undefined;
			const text = !c
				? ""
				: typeof c === "string"
					? c
					: Array.isArray(c)
						? c.map((x) => (typeof x === "string" ? x : (x.value ?? ""))).join("\n")
						: (c.value ?? "");
			return ok(text.trim());
		},
	});

	pi.registerTool({
		name: "lsp_rename",
		label: "Rename",
		description:
			"Rename a symbol project-wide using the language server's own refactor. This is the SAFE way to rename: it updates exactly the semantic references and nothing else, unlike sed or ast_rewrite which cannot tell a real usage from a same-named one. Previews the edit set by default; pass apply:true to write.",
		promptSnippet: "Rename a symbol project-wide via the language server (preview by default)",
		promptGuidelines: [
			"Use lsp_rename for renames rather than edit, sed, or ast_rewrite — only the language server knows which occurrences are actually the same symbol. Preview first, then re-run with apply:true.",
		],
		parameters: Type.Object({
			...symbolParams,
			newName: Type.String({ description: "New symbol name" }),
			apply: Type.Optional(Type.Boolean({ description: "Write the edits. Default false = preview only." })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const at = await locate(ctx.cwd, params.path, params.symbol);
			const edit = (await at.session.conn.sendRequest("textDocument/rename", {
				textDocument: { uri: at.uri },
				position: { line: at.line, character: at.character },
				newName: params.newName,
			})) as { changes?: Record<string, unknown[]>; documentChanges?: unknown[] } | null;

			if (!edit) return ok(`Server declined to rename '${params.symbol}'.`);

			const changes: Record<string, unknown[]> = edit.changes ?? {};
			if (edit.documentChanges) {
				for (const dc of edit.documentChanges as { textDocument?: { uri: string }; edits?: unknown[] }[]) {
					if (dc.textDocument?.uri && dc.edits) changes[dc.textDocument.uri] = dc.edits;
				}
			}

			const files = Object.keys(changes);
			const summary = files
				.map((u) => `  ${relative(ctx.cwd, fileURLToPath(u))} (${changes[u].length} edit(s))`)
				.join("\n");

			if (!params.apply) {
				return ok(
					`Rename '${params.symbol}' → '${params.newName}' would touch ${files.length} file(s):\n${summary}\n\n(preview only — re-run with apply:true to write)`,
				);
			}

			for (const uri of files) {
				const file = fileURLToPath(uri);
				const edits = changes[uri] as { range: Loc["range"] & { end: { line: number; character: number } }; newText: string }[];
				const lines = readFileSync(file, "utf8").split("\n");
				// Apply bottom-up so earlier edits don't invalidate later offsets.
				const sorted = [...edits].sort(
					(a, b) => b.range.start.line - a.range.start.line || b.range.start.character - a.range.start.character,
				);
				for (const e of sorted) {
					const { start, end } = e.range;
					if (start.line === end.line) {
						const l = lines[start.line];
						lines[start.line] = l.slice(0, start.character) + e.newText + l.slice(end.character);
					} else {
						const head = lines[start.line].slice(0, start.character);
						const tail = lines[end.line].slice(end.character);
						lines.splice(start.line, end.line - start.line + 1, head + e.newText + tail);
					}
				}
				const { writeFileSync } = await import("node:fs");
				writeFileSync(file, lines.join("\n"), "utf8");
			}
			// We just wrote these files behind the server's back; resync before
			// anything else queries them.
			refreshAll();
			return ok(`Renamed '${params.symbol}' → '${params.newName}' across ${files.length} file(s):\n${summary}`);
		},
	});

	pi.registerTool({
		name: "lsp_diagnostics",
		label: "Diagnostics",
		description:
			"Get compiler/type errors and warnings for a file from the language server — the same errors a build would produce, without running the build. Use after edits to verify a refactor landed cleanly.",
		promptSnippet: "Get type/compile errors for a file without running a build",
		promptGuidelines: [
			"Use lsp_diagnostics after a refactor to confirm it type-checks, instead of running a full build when you only need one file's errors.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "File to check, relative to cwd" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const file = resolve(ctx.cwd, params.path.replace(/^@/, ""));
			if (!existsSync(file)) throw new Error(`No such file: ${file}`);
			const spec = specFor(file);
			if (!spec) throw new Error(`No language server available for ${extname(file)}.`);
			const session = await getSession(spec, findRoot(file, spec, ctx.cwd));
			refreshAll();
			const uri = openDoc(session, file);

			// Diagnostics arrive as a push notification, so give the server a beat.
			await new Promise((r) => setTimeout(r, session.busy > 0 ? 3000 : 1200));

			const diags = (diagnostics.get(uri) ?? []) as {
				range: { start: { line: number; character: number } };
				severity?: number;
				message: string;
				source?: string;
			}[];
			if (diags.length === 0) return ok("No diagnostics.");

			const sev = ["", "error", "warning", "info", "hint"];
			return ok(
				diags
					.map(
						(d) =>
							`${relative(ctx.cwd, file)}:${d.range.start.line + 1}:${d.range.start.character + 1} ${sev[d.severity ?? 1]}: ${d.message}${d.source ? ` [${d.source}]` : ""}`,
					)
					.join("\n"),
			);
		},
	});

	pi.registerTool({
		name: "lsp_symbols",
		label: "Symbols",
		description:
			"List the symbols declared in a file (functions, classes, methods, types) with their line numbers — a structural outline. Much cheaper than reading a large file when you only need to know what's in it.",
		promptSnippet: "Outline the symbols declared in a file",
		promptGuidelines: [
			"Use lsp_symbols to outline a large file before reading it, so you can read only the region that matters.",
		],
		parameters: Type.Object({
			path: Type.String({ description: "File to outline, relative to cwd" }),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const file = resolve(ctx.cwd, params.path.replace(/^@/, ""));
			if (!existsSync(file)) throw new Error(`No such file: ${file}`);
			const spec = specFor(file);
			if (!spec) throw new Error(`No language server available for ${extname(file)}.`);
			const session = await getSession(spec, findRoot(file, spec, ctx.cwd));
			refreshAll();
			const uri = openDoc(session, file);
			const syms = (await session.conn.sendRequest("textDocument/documentSymbol", {
				textDocument: { uri },
			})) as SymbolNode[] | null;

			const kinds = ["", "File", "Module", "Namespace", "Package", "Class", "Method", "Property", "Field",
				"Constructor", "Enum", "Interface", "Function", "Variable", "Constant", "String", "Number",
				"Boolean", "Array", "Object", "Key", "Null", "EnumMember", "Struct", "Event", "Operator", "TypeParameter"];

			const lines: string[] = [];
			const walk = (nodes: SymbolNode[] | null, depth: number) => {
				for (const n of nodes ?? []) {
					const start = (n.selectionRange ?? n.range ?? n.location?.range)?.start;
					const kind = kinds[(n as unknown as { kind?: number }).kind ?? 0] ?? "";
					lines.push(`${"  ".repeat(depth)}${kind ? `${kind} ` : ""}${n.name}${start ? `  :${start.line + 1}` : ""}`);
					walk(n.children ?? null, depth + 1);
				}
			};
			walk(syms, 0);
			return ok(lines.join("\n"));
		},
	});

	// -------------------------------------------------------------- lifecycle

	pi.registerCommand("lsp", {
		description: "Show language server status (running servers, available binaries)",
		handler: async (_args, ctx) => {
			const running = [...sessions.entries()].map(
				([k, s]) => `  ${k.split(":")[0]} @ ${relative(ctx.cwd, s.root) || "."}${s.busy > 0 ? " (indexing)" : ""}`,
			);
			const available = SERVERS.filter((s) => which(s.cmd)).map((s) => s.id);
			const missing = SERVERS.filter((s) => !which(s.cmd)).map((s) => s.id);
			ctx.ui.notify(
				[
					`running:   ${running.length ? `\n${running.join("\n")}` : "none (servers start on first use)"}`,
					`available: ${available.join(", ") || "none"}`,
					`missing:   ${missing.join(", ") || "none"}`,
				].join("\n"),
				"info",
			);
		},
	});

	// Language servers are long-lived child processes; leaking them across
	// sessions would leave rust-analyzer instances chewing CPU in the background.
	pi.on("session_shutdown", async () => {
		for (const s of sessions.values()) {
			try {
				await s.conn.sendRequest("shutdown");
				s.conn.sendNotification("exit");
			} catch {}
			s.conn.dispose();
			s.proc.kill();
		}
		sessions.clear();
	});
}
