export interface SourceSection {
  title: string;
  text: string;
}

/** One document from some source. `id` becomes the chunk's `doc`, so it must be stable between runs. */
export interface SourceDoc {
  id: string;
  url: string;
  sections: SourceSection[];
}

export interface Connector {
  readonly kind: string;
  load(): Promise<SourceDoc[]>;
}
