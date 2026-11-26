import path from "node:path";
import { parseRst } from "../rst";
import { listFiles, readText } from "./files";
import type { Connector, SourceDoc } from "./types";

/** The Python library docs in Sphinx format (the original source of this project). */
export class RstConnector implements Connector {
  readonly kind = "rst";
  constructor(private readonly dir: string) {}

  async load(): Promise<SourceDoc[]> {
    const docs: SourceDoc[] = [];
    for (const file of await listFiles(this.dir, [".rst"])) {
      const id = file.replace(/\.rst$/, "");
      const sections = parseRst(await readText(path.join(this.dir, file)));
      docs.push({
        id,
        url: `https://docs.python.org/3.12/library/${id}.html`,
        sections: sections.map((s) => ({ title: s.title || id, text: s.text })),
      });
    }
    return docs;
  }
}
