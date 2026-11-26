import path from "node:path";
import { describe, expect, it } from "vitest";
import { MarkdownConnector, markdownSections } from "@/lib/connectors/markdown";
import { cleanNotionMarkdown, NotionConnector, stripNotionIds } from "@/lib/connectors/notion";
import { cleanSlackText, SlackConnector } from "@/lib/connectors/slack";
import { createConnector } from "@/lib/connectors";

const samples = path.join(process.cwd(), "examples", "sources");

describe("markdown", () => {
  it("splits at headings and ignores # lines inside code fences", () => {
    const text = "intro text\n\n# One\nfirst\n```\n# not a heading\n```\n## Two\nsecond\n";
    expect(markdownSections(text, "File")).toEqual([
      { title: "File", text: "intro text" },
      { title: "One", text: "first\n```\n# not a heading\n```" },
      { title: "Two", text: "second" },
    ]);
  });

  it("reads a folder, with ids from relative paths", async () => {
    const docs = await new MarkdownConnector(path.join(samples, "markdown")).load();
    expect(docs.map((d) => d.id)).toEqual(["md/python-style", "md/team/release-checklist"]);
    expect(docs[0]!.sections.map((s) => s.title)).toEqual(["Reading files", "Time and dates"]);
  });
});

describe("notion", () => {
  it("removes the id suffix from names", () => {
    expect(stripNotionIds("Logging guide fedcba9876543210fedcba9876543210.md")).toBe("Logging guide.md");
    expect(stripNotionIds("Plain name.md")).toBe("Plain name.md");
  });

  it("turns page links into text and drops images", () => {
    const out = cleanNotionMarkdown("See [the guide](Guide%20abc.md) and ![pic](a.png) and [site](https://x.org).");
    expect(out).toBe("See the guide and  and site.");
  });

  it("reads an export with nested pages and a title from the first heading", async () => {
    const docs = await new NotionConnector(path.join(samples, "notion")).load();
    expect(docs.map((d) => d.id)).toEqual([
      "notion/Engineering Wiki",
      "notion/Engineering Wiki/Local setup",
      "notion/Engineering Wiki/Logging guide",
    ]);
    const logging = docs.find((d) => d.id.endsWith("Logging guide"))!;
    expect(logging.sections.map((s) => s.title)).toEqual(["Logging guide", "Levels", "Format"]);
  });
});

describe("slack", () => {
  it("turns mentions and links into plain text", () => {
    const names = new Map([["U1", "Sam Rivera"]]);
    expect(cleanSlackText("hi <@U1>, see <https://a.org|the docs> &amp; <#C1|general>", names)).toBe(
      "hi @Sam Rivera, see the docs (https://a.org) & #general",
    );
  });

  it("makes one document per channel and day and one section per thread, skipping joins", async () => {
    const docs = await new SlackConnector(path.join(samples, "slack")).load();
    expect(docs.map((d) => d.id)).toEqual(["slack/general/2026-03-02", "slack/python-help/2026-03-03"]);
    expect(docs[0]!.sections).toHaveLength(1);
    expect(docs[0]!.sections[0]!.text).not.toContain("has joined");
    const thread = docs[1]!.sections[0]!;
    expect(thread.text.split("\n")).toHaveLength(3);
    expect(thread.text).toContain("Sam Rivera: Use a threading.Lock");
    expect(thread.text).toContain("the threading docs (https://docs.python.org/3/library/threading.html)");
  });
});

describe("createConnector", () => {
  it("rejects an unknown source", () => {
    expect(() => createConnector("ftp", ".")).toThrow(/Unknown source/);
  });
});
