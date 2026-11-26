import path from "node:path";
import { listFiles, readText } from "./files";
import { markdownSections } from "./markdown";
import type { Connector, SourceDoc } from "./types";

/** Notion appends a 32 character hex id to every file and folder name: "Meeting notes 1a2b...ef.md". */
const NOTION_ID = /\s+[0-9a-f]{32}(?=\.|$)/;

export const stripNotionIds = (name: string): string => name.replace(NOTION_ID, "");

/**
 * Cleans Notion's Markdown export: `[text](Other%20Page%20<id>.md)` links become plain text,
 * image lines are dropped, and external links keep their label.
 */
export function cleanNotionMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n");
}

/** A Notion "Export as Markdown" folder. Page titles come from the first `#` line, ids are removed from paths. */
export class NotionConnector implements Connector {
  readonly kind = "notion";
  constructor(private readonly dir: string) {}

  async load(): Promise<SourceDoc[]> {
    const docs: SourceDoc[] = [];
    for (const file of await listFiles(this.dir, [".md"])) {
      const clean = file.split("/").map(stripNotionIds).join("/").replace(/\.md$/, "");
      const raw = await readText(path.join(this.dir, file));
      const title = /^#\s+(.+)$/m.exec(raw)?.[1]?.trim() ?? path.basename(clean);
      const body = cleanNotionMarkdown(raw.replace(/^#\s+.+\n/, ""));
      docs.push({ id: `notion/${clean}`, url: `notion:${clean}`, sections: markdownSections(body, title) });
    }
    return docs;
  }
}
