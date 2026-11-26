import { MarkdownConnector } from "./markdown";
import { NotionConnector } from "./notion";
import { RstConnector } from "./rst";
import { SlackConnector } from "./slack";
import type { Connector } from "./types";

export const CONNECTOR_KINDS = ["rst", "markdown", "notion", "slack"] as const;

export function createConnector(kind: string, dir: string): Connector {
  switch (kind) {
    case "rst":
      return new RstConnector(dir);
    case "markdown":
      return new MarkdownConnector(dir);
    case "notion":
      return new NotionConnector(dir);
    case "slack":
      return new SlackConnector(dir);
    default:
      throw new Error(`Unknown source "${kind}". Use one of: ${CONNECTOR_KINDS.join(", ")}.`);
  }
}

export type { Connector, SourceDoc, SourceSection } from "./types";
