import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { readStatus } from "./status.ts";

// Powerline consumes this status through its documented custom-item API.
export default function vcsStatus(pi: ExtensionAPI, getStatus = readStatus) {
  let timer: ReturnType<typeof setInterval> | undefined;
  let debounce: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let pending = false;
  let context: ExtensionContext | undefined;

  function stop() {
    generation++;
    if (timer) clearInterval(timer);
    if (debounce) clearTimeout(debounce);
    timer = undefined;
    debounce = undefined;
    pending = false;
    context = undefined;
  }

  async function refresh() {
    if (!context || pending) return;
    const ctx = context;
    const current = generation;
    pending = true;
    try {
      const status = await getStatus(ctx.cwd);
      if (current !== generation) return;
      let text: string | undefined;
      if (status) {
        const color = status.warning || status.dirty ? "warning" : "success";
        // Same Nerd Font branch icon as powerline’s original Git segment.
        text = ctx.ui.theme.fg(color, `\uF126 ${status.text}`);
      }
      ctx.ui.setStatus("vcs", text);
    } finally {
      if (current === generation) pending = false;
    }
  }

  async function start(ctx: ExtensionContext) {
    stop();
    if (ctx.mode !== "tui") return;
    context = ctx;
    const current = generation;
    ctx.ui.setStatus("vcs", undefined);
    await refresh();
    if (current !== generation) return;
    timer = setInterval(() => { void refresh(); }, 5000);
    timer.unref();
  }

  pi.on("session_start", (_event, ctx) => start(ctx));
  pi.on("tool_execution_end", () => {
    if (!context) return;
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => { void refresh(); }, 250);
    debounce.unref();
  });
  pi.on("agent_end", () => refresh());
  pi.on("session_shutdown", (_event, ctx) => {
    stop();
    ctx.ui.setStatus("vcs", undefined);
  });
}
