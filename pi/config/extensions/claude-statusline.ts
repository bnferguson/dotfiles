import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth } from "@earendil-works/pi-tui";

function formatCwd(cwd: string): string {
	const home = process.env.HOME;
	const shortened = home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd;
	return shortened.replace(/^\//, "");
}

export default function (pi: ExtensionAPI) {
	let linesAdded = 0;
	let linesRemoved = 0;
	let worktreeName: string | undefined;
	let pullRequest: { number: number; url: string } | undefined;
	let displayCwd: string | undefined;
	let codeIntelMode: "off" | "on" | "strict" = "off";
	let requestRender: (() => void) | undefined;

	pi.events.on("code-intel:mode", (mode: unknown) => {
		if (mode !== "off" && mode !== "on" && mode !== "strict") return;
		codeIntelMode = mode;
		requestRender?.();
	});

	const refreshGitDetails = async (cwd: string) => {
		const [diff, root, commonDir, gitDir, pr] = await Promise.all([
			pi.exec("git", ["diff", "HEAD", "--numstat"], { cwd }).catch(() => undefined),
			pi.exec("git", ["rev-parse", "--show-toplevel"], { cwd }).catch(() => undefined),
			pi.exec("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd }).catch(() => undefined),
			pi.exec("git", ["rev-parse", "--path-format=absolute", "--git-dir"], { cwd }).catch(() => undefined),
			pi.exec("gh", ["pr", "view", "--json", "number,url"], { cwd }).catch(() => undefined),
		]);

		linesAdded = 0;
		linesRemoved = 0;
		for (const line of diff?.stdout.trim().split("\n") ?? []) {
			const [added, removed] = line.split("\t");
			if (added !== "-") linesAdded += Number(added) || 0;
			if (removed !== "-") linesRemoved += Number(removed) || 0;
		}

		const repoRoot = root?.stdout.trim();
		const common = commonDir?.stdout.trim();
		const currentGitDir = gitDir?.stdout.trim();
		const isWorktree = Boolean(repoRoot && common && currentGitDir && common !== currentGitDir);
		worktreeName = isWorktree ? currentGitDir!.split("/").pop() : undefined;
		try {
			const parsed = JSON.parse(pr?.stdout || "null") as { number?: number; url?: string } | null;
			pullRequest = parsed?.number && parsed.url ? { number: parsed.number, url: parsed.url } : undefined;
		} catch {
			pullRequest = undefined;
		}
		displayCwd = isWorktree && common!.endsWith("/.git")
			? `${common!.slice(0, -5)}${cwd.slice(repoRoot!.length)}`
			: cwd;
		requestRender?.();
	};

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		void refreshGitDetails(ctx.cwd);

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestRender = () => tui.requestRender();
			const unsubscribe = footerData.onBranchChange(() => {
				void refreshGitDetails(ctx.cwd);
			});

			return {
				dispose() {
					unsubscribe();
					requestRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					const branch = footerData.getGitBranch() || "detached";
					const cwd = theme.fg("border", formatCwd(displayCwd ?? ctx.cwd));
					const separator = theme.fg("dim", " | ");
					const branchText = theme.fg("borderAccent", branch);
					const worktree = worktreeName ? ` ${theme.fg("warning", `[wt: ${worktreeName}]`)}` : "";
					const pr = pullRequest
						? ` \x1b]8;;${pullRequest.url}\x07${theme.fg("accent", `[pr: #${pullRequest.number}]`)}\x1b]8;;\x07`
						: "";

					const usage = ctx.getContextUsage();
					const percent = usage?.percent;
					let context = "";
					if (percent !== null && percent !== undefined) {
						const rounded = Math.round(percent);
						const color = rounded >= 80 ? "error" : rounded >= 50 ? "warning" : "success";
						context = ` ${theme.fg(color, `ctx:${rounded}%`)}`;
					}

					let cost = 0;
					for (const entry of ctx.sessionManager.getBranch()) {
						if (entry.type === "message" && entry.message.role === "assistant") {
							cost += (entry.message as AssistantMessage).usage.cost.total;
						}
					}
					const costText = cost > 0 ? ` ${theme.fg("dim", `$${cost.toFixed(4)}`)}` : "";
					const changed = linesAdded || linesRemoved
						? ` ${theme.fg("success", `+${linesAdded}`)}${theme.fg("error", `-${linesRemoved}`)}`
						: "";
					const model = theme.fg("dim", ctx.model?.name || ctx.model?.id || "no model");
					const codeIntelColor = codeIntelMode === "strict" ? "warning" : codeIntelMode === "on" ? "accent" : "muted";
					const codeIntel = theme.fg(codeIntelColor, ` intel:${codeIntelMode}`);

					return [
						truncateToWidth(`${cwd}${separator}${branchText}${worktree}${pr}`, width),
						truncateToWidth(`${model}${codeIntel}${context}${costText}${changed}`, width),
					];
				},
			};
		});
	});

	pi.on("tool_execution_end", (event, ctx) => {
		if (ctx.mode === "tui" && ["bash", "edit", "write"].includes(event.toolName)) {
			void refreshGitDetails(ctx.cwd);
		}
	});

	pi.on("session_shutdown", () => {
		requestRender = undefined;
	});
}
