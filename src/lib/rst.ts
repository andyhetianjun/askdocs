// A small reStructuredText reader, just enough for the Python library docs:
// it finds section headings and strips Sphinx markup so the text reads normally.

export interface Section {
  title: string;
  level: number;
  text: string;
}

const UNDERLINE = /^([=\-^"~#*+`:'.])\1{2,}\s*$/;
const SKIP_DIRECTIVES =
  /^\.\. (module|moduleauthor|sectionauthor|index|currentmodule|testsetup|testcleanup|include|toctree|only|audit-event-table|_[^:]+):/;
const SIGNATURE_DIRECTIVES =
  /^\.\. (?:py:)?(function|class|method|classmethod|staticmethod|attribute|data|exception|decorator|decoratormethod|describe|option|program|cmdoption):: ?(.*)$/;

export function cleanInline(s: string): string {
  return s
    .replace(/:[a-zA-Z:]+:`([^`]*?)\s*<([^>]+)>`/g, (_m, label: string, target: string) =>
      label.trim() ? label.replace(/^[~!]/, "") : target,
    )
    .replace(/:[a-zA-Z:]+:`([^`]+)`/g, (_m, t: string) => t.replace(/^[~!]/, ""))
    .replace(/``([^`]+)``/g, "$1")
    .replace(/`([^`<]+?)(?:\s*<[^>]+>)?`_{1,2}/g, "$1")
    .replace(/ --- /g, " - ")
    .replace(/\|[a-z_]+\|/g, "");
}

export function parseRst(source: string): Section[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const sections: Section[] = [];
  const levels: string[] = [];
  let current: { title: string; level: number; lines: string[] } = { title: "", level: 0, lines: [] };

  const flush = () => {
    const text = tidy(current.lines);
    if (current.title || text) sections.push({ title: current.title, level: current.level, text });
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const next = lines[i + 1] ?? "";
    const isTitle =
      line.trim() !== "" &&
      !/^\s/.test(line) &&
      !UNDERLINE.test(line) &&
      UNDERLINE.test(next) &&
      next.trim().length >= Math.min(line.trim().length, 3);
    if (isTitle) {
      flush();
      const ch = next.trim()[0] ?? "=";
      let level = levels.indexOf(ch);
      if (level === -1) {
        levels.push(ch);
        level = levels.length - 1;
      }
      current = { title: cleanInline(line.trim()), level, lines: [] };
      i++; // skip the underline
      continue;
    }
    current.lines.push(line);
  }
  flush();
  return sections;
}

function tidy(raw: string[]): string {
  const out: string[] = [];
  for (const line of raw) {
    const trimmed = line.trim();
    if (SKIP_DIRECTIVES.test(trimmed)) continue;
    if (/^\.\. (versionadded|versionchanged|deprecated|versionremoved|seealso|availability|impl-detail|note|warning|code-block|testcode|doctest|sourcecode|highlight|parsed-literal|literalinclude|rubric|admonition|tab|productionlist|attention|caution|important|tip)::/.test(trimmed)) {
      // keep the useful text that follows the directive name, drop the marker
      const rest = trimmed.replace(/^\.\. [a-z-]+::\s*/, "");
      if (/^(python|pycon|sh|bash|shell|console|text|none|c|json)$/.test(rest)) continue;
      if (rest) out.push(cleanInline(rest));
      continue;
    }
    if (/^\.\. _[^:]+:/.test(trimmed)) continue;
    if (/^\.\. /.test(trimmed) && !SIGNATURE_DIRECTIVES.test(trimmed)) {
      if (/^\.\. [a-z:-]+::/.test(trimmed)) continue;
      if (/^\.\. \|/.test(trimmed)) continue;
      continue; // comments
    }
    const sig = SIGNATURE_DIRECTIVES.exec(trimmed);
    if (sig) {
      if (sig[2]) out.push(cleanInline(sig[2]));
      continue;
    }
    if (/^:[a-z-]+:(\s|$)/.test(trimmed) && /^\s/.test(line)) continue; // directive options
    if (trimmed === "::") continue;
    out.push(cleanInline(line.trimEnd().replace(/::$/, ":")));
  }
  const joined = dedent(out).join("\n").replace(/\\\n\s*/g, "");
  return cleanInline(joined).replace(/\n{3,}/g, "\n\n").trim();
}

function dedent(lines: string[]): string[] {
  // remove the 3-space indent that directive bodies carry, keep deeper code indentation
  return lines.map((l) => (l.startsWith("   ") ? l.slice(3) : l.trimStart()));
}
