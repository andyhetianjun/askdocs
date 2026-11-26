import { describe, expect, it } from "vitest";
import { reciprocalRankFusion } from "@/lib/rrf";

const ids = (...xs: string[]) => xs.map((id) => ({ id }));

describe("reciprocalRankFusion", () => {
  it("puts an item found by both lists above items found by one", () => {
    const fused = reciprocalRankFusion([ids("a", "b", "c"), ids("d", "b", "e")]);
    expect(fused[0]?.id).toBe("b");
  });

  it("scores rank 1 as 1 / (k + 1)", () => {
    const [top] = reciprocalRankFusion([ids("a")], 60);
    expect(top?.score).toBeCloseTo(1 / 61);
  });

  it("adds the contribution of each list", () => {
    const fused = reciprocalRankFusion([ids("a", "b"), ids("b", "a")], 10);
    const a = fused.find((f) => f.id === "a")!;
    expect(a.score).toBeCloseTo(1 / 11 + 1 / 12);
  });

  it("returns every item once", () => {
    const fused = reciprocalRankFusion([ids("a", "b"), ids("b", "c")]);
    expect(fused.map((f) => f.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("breaks ties by id so results are stable", () => {
    const fused = reciprocalRankFusion([ids("b"), ids("a")]);
    expect(fused.map((f) => f.id)).toEqual(["a", "b"]);
  });

  it("handles no input", () => {
    expect(reciprocalRankFusion([])).toEqual([]);
  });
});
