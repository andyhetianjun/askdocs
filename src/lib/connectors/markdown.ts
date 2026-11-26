import path from "node:path";
import { listFiles, readText } from "./files";
import type { Connector, SourceDoc, SourceSection } from "./types";

/** Splits Markdown at `#` headings. Lines inside code fences are never treated as headings. */
export function markdownSections(text: string, fallbackTitle: string): SourceSection[] {
  const sections: SourceSection[] = [];
  let title = fallbackTitle;
  let lines: string[] = [];
  let fenced = false;

  const flush = () => {
    const body = lines.join("\n").trim();
    if (body) sections.push({ title, text: body });
    lines = [];
  };

  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      flush();
      title = heading[1]!;
    } else lines.push(line);
  }
  flush();
  return sections;
}

/** A folder of Markdown files. The document id is the path inside the folder, without `.md`. */
export class MarkdownConnector implements Connector {
  readonly kind = "markdown";
  constructor(private readonly dir: string) {}

  async load(): Promise<SourceDoc[]> {
    const docs: SourceDoc[] = [];
    for (const file of await listFiles(this.dir, [".md", ".markdown"])) {
      const id = `md/${file.replace(/\.(md|markdown)$/i, "")}`;
      const fallback = path.basename(file).replace(/\.(md|markdown)$/i, "").replace(/[-_]/g, " ");
      docs.push({ id, url: file, sections: markdownSections(await readText(path.join(this.dir, file)), fallback) });
    }
    return docs;
  }
}
