import { readdir } from "node:fs/promises";
import path from "node:path";
import { readText } from "./files";
import type { Connector, SourceDoc, SourceSection } from "./types";

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  user_name?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
}

interface SlackUser {
  id: string;
  name?: string;
  real_name?: string;
}

const SKIPPED_SUBTYPES = new Set(["channel_join", "channel_leave", "channel_topic", "channel_purpose", "bot_add"]);

/** Turns Slack's message markup into plain text: `<@U1>` becomes a name, `<url|label>` becomes the label. */
export function cleanSlackText(text: string, names: Map<string, string>): string {
  return text
    .replace(/<@([A-Z0-9]+)(?:\|[^>]*)?>/g, (_m, id: string) => `@${names.get(id) ?? id}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, "#$1")
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, "$2 ($1)")
    .replace(/<(https?:[^>]+)>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * A Slack workspace export: `users.json` and one folder per channel holding one JSON file per day.
 * Each channel-day is one document and each thread (a message and its replies) is one section.
 */
export class SlackConnector implements Connector {
  readonly kind = "slack";
  constructor(private readonly dir: string) {}

  async load(): Promise<SourceDoc[]> {
    const names = new Map<string, string>();
    try {
      for (const u of JSON.parse(await readText(path.join(this.dir, "users.json"))) as SlackUser[]) {
        names.set(u.id, u.real_name || u.name || u.id);
      }
    } catch {
      // users.json is optional; messages then show raw user ids
    }

    const docs: SourceDoc[] = [];
    const channels = (await readdir(this.dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
    for (const channel of channels) {
      const days = (await readdir(path.join(this.dir, channel))).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
      for (const day of days) {
        const date = day.replace(".json", "");
        const messages = JSON.parse(await readText(path.join(this.dir, channel, day))) as SlackMessage[];
        const sections = threadSections(messages, channel, date, names);
        if (sections.length > 0) docs.push({ id: `slack/${channel}/${date}`, url: `slack://${channel}/${date}`, sections });
      }
    }
    return docs;
  }
}

function threadSections(messages: SlackMessage[], channel: string, date: string, names: Map<string, string>): SourceSection[] {
  const threads = new Map<string, string[]>();
  for (const m of [...messages].sort((a, b) => Number(a.ts) - Number(b.ts))) {
    if (m.type !== "message" || !m.text?.trim() || (m.subtype && SKIPPED_SUBTYPES.has(m.subtype))) continue;
    const who = names.get(m.user ?? "") ?? m.user_name ?? m.user ?? "someone";
    const key = m.thread_ts ?? m.ts ?? String(threads.size);
    const lines = threads.get(key) ?? [];
    lines.push(`${who}: ${cleanSlackText(m.text, names)}`);
    threads.set(key, lines);
  }
  return [...threads.values()].map((lines) => {
    const opening = lines[0]!.replace(/^[^:]+:\s*/, "").split(/\s+/).slice(0, 8).join(" ");
    return { title: `#${channel} ${date}: ${opening}`, text: lines.join("\n") };
  });
}
