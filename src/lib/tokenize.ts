const STOPWORDS = new Set(
  ("a an and are as at be but by can do does for from how i if in into is it its of on or " +
    "so than that the their then there these they this to use used using was what when where which who why will with you your")
    .split(" "),
);

/** Lowercase word tokens. Underscores stay inside a token so `os_path` is one word. */
export function tokenize(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return raw.filter((t) => t.length > 1 && !STOPWORDS.has(t)).map(stem);
}

/** Very light plural stripping so "files" matches "file". */
function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

/** Query words without stemming, for Postgres full-text search (it stems on its own). */
export function queryTerms(text: string): string[] {
  const raw = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return [...new Set(raw.filter((t) => t.length > 1 && !STOPWORDS.has(t)))];
}
