// == Responsibility: Resolve branch-local PR and Linear links for the Powerline status item.
import { run, type Run } from "./status.ts";

interface Ticket { id: string; url: string }
interface PullRequest { number: number; url: string }
export interface WorkLinks { pr?: PullRequest; ticket?: Ticket }

function ticketIds(text: string): string[] {
  return [...new Set((text.match(/\b[A-Z][A-Z0-9]{1,9}-\d+\b(?!\.\d)/gi) ?? []).map(id => id.toUpperCase()))];
}

export function detectTicket(branch: string, title: string, body: string): Ticket | undefined {
  for (const source of [branch, title, body]) {
    const ids = ticketIds(source);
    if (!ids.length) continue;
    if (ids.length !== 1) return undefined;
    const id = ids[0];
    const urls = `${title}\n${body}`.match(/https:\/\/linear\.app\/[^\s\x00-\x1f\x7f<>"'`\)\]]+/g) ?? [];
    const canonical = urls.find(url => ticketIds(new URL(url).pathname).includes(id));
    return { id, url: canonical ?? `https://linear.app/issue/${id}` };
  }
  return undefined;
}

function hyperlink(url: string, text: string): string {
  return `\x1b]8;;${url}\x07${text}\x1b]8;;\x07`;
}

export function formatWorkLinks(links: WorkLinks | undefined): string | undefined {
  const parts: string[] = [];
  if (links?.pr) parts.push(hyperlink(links.pr.url, `PR #${links.pr.number}`));
  if (links?.ticket) parts.push(hyperlink(links.ticket.url, links.ticket.id));
  return parts.join(" ") || undefined;
}

export function createWorkLinksReader(execute: Run = run, now = Date.now) {
  let cached: { key: string; at: number; links: WorkLinks } | undefined;
  return async (cwd: string): Promise<WorkLinks | undefined> => {
    let branch: string;
    try {
      branch = (await execute("git", ["symbolic-ref", "--short", "HEAD"], cwd)).trim();
    } catch {
      cached = undefined;
      return undefined;
    }
    const key = `${cwd}\0${branch}`;
    if (cached?.key === key && now() - cached.at < 60_000) return cached.links;
    const links: WorkLinks = {};
    let title = "", body = "";
    try {
      const pr: unknown = JSON.parse(await execute("gh", ["pr", "view", "--json", "number,url,title,body,state"], cwd));
      if (pr && typeof pr === "object" && "state" in pr && pr.state === "OPEN") {
        if ("number" in pr && typeof pr.number === "number" && Number.isSafeInteger(pr.number) && pr.number > 0 &&
            "url" in pr && typeof pr.url === "string" && /^https:\/\/[^\s\x00-\x1f\x7f]+$/.test(pr.url)) {
          links.pr = { number: pr.number, url: pr.url };
        }
        if ("title" in pr && typeof pr.title === "string") title = pr.title;
        if ("body" in pr && typeof pr.body === "string") body = pr.body;
      }
    } catch {
      // Local branch tickets remain useful when GitHub or authentication is unavailable.
    }
    const ticket = detectTicket(branch, title, body);
    if (ticket) links.ticket = ticket;
    cached = { key, at: now(), links };
    return links;
  };
}

export const readWorkLinks = createWorkLinksReader();
