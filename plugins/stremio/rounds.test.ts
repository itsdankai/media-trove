import { describe, expect, it } from "vitest";
import { hasActivity, type LibraryItem, processBudgeted } from "./plugin.ts";

describe("stremio items", () => {
  const item = (state: Partial<LibraryItem["state"]>, removed = true): LibraryItem => ({
    _id: "tt9362722",
    name: "Spider-Man: Across the Spider-Verse",
    type: "movie",
    removed,
    temp: removed,
    _mtime: "2026-10-05T22:50:35Z",
    state: { timeOffset: 0, duration: 8_400_000, timesWatched: 0, flaggedWatched: 0, ...state },
  });
  it("counts things played without adding them to the library", () => {
    expect(hasActivity(item({ timeOffset: 756_000 }))).toBe(true); // removed + temp, 9% in
    expect(hasActivity(item({}))).toBe(false); // opened, never played
  });
});

describe("stremio rounds", () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ _id: `tt${i}` }));

  it("processes in batches and marks failures for retry instead of failing the sync", async () => {
    const r = await processBudgeted(
      items,
      async (it) => (it._id === "tt3" ? Promise.reject(new Error("timeout")) : []),
      {
        concurrency: 4,
        budgetMs: 10_000,
      },
    );
    expect(r).toMatchObject({ done: 10, failed: ["tt3"] });
  });

  it("stops when the time budget runs out", async () => {
    const slow = () => new Promise<[]>((resolve) => setTimeout(() => resolve([]), 30));
    const r = await processBudgeted(items, slow, { concurrency: 2, budgetMs: 40 });
    expect(r.done).toBeLessThan(10);
  });
});
