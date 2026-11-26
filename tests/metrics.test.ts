import { describe, expect, it } from "vitest";
import { firstHitRank, meanReciprocalRank, recallAtK } from "@/lib/metrics";

describe("firstHitRank", () => {
  const results = [
    { doc: "re", section: "Flags" },
    { doc: "json", section: "Basic Usage" },
    { doc: "json", section: "Exceptions" },
  ];

  it("finds a section match", () => {
    expect(firstHitRank(results, { doc: "json", section: "Exceptions" })).toBe(3);
  });

  it("needs the section to match at section level", () => {
    expect(firstHitRank(results, { doc: "json", section: "Nope" })).toBeNull();
  });

  it("ignores the section at doc level", () => {
    expect(firstHitRank(results, { doc: "json", section: "Nope" }, "doc")).toBe(2);
  });
});

describe("recallAtK and MRR", () => {
  const ranks = [1, 3, null, 6];

  it("counts hits inside the cutoff", () => {
    expect(recallAtK(ranks, 5)).toBe(0.5);
    expect(recallAtK(ranks, 1)).toBe(0.25);
  });

  it("averages reciprocal ranks and treats a miss as zero", () => {
    expect(meanReciprocalRank(ranks)).toBeCloseTo((1 + 1 / 3 + 0 + 1 / 6) / 4);
  });

  it("returns 0 for no queries", () => {
    expect(recallAtK([], 5)).toBe(0);
    expect(meanReciprocalRank([])).toBe(0);
  });
});
