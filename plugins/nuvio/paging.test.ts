import { describe, expect, it } from "vitest";
import { pullWatched, type WatchedItem } from "./plugin.ts";

// 2,500 watched items, newest first, served 1,000 per page like Nuvio's server.
const items: WatchedItem[] = Array.from({ length: 2500 }, (_, i) => ({
  content_id: "tt0118276",
  content_type: "series",
  title: "x",
  season: 1,
  episode: i + 1,
  watched_at: 1_000_000 - i,
}));
const server = (calls: number[]) => async (page: number) => {
  calls.push(page);
  return items.slice((page - 1) * 1000, page * 1000);
};

describe("nuvio paging", () => {
  it("reads every page on a first sync", async () => {
    const calls: number[] = [];
    expect(await pullWatched(server(calls), 0)).toHaveLength(2500);
    expect(calls).toEqual([1, 2, 3]);
  });

  it("stops at the first page that reaches already-seen items", async () => {
    const calls: number[] = [];
    await pullWatched(server(calls), 1_000_000 - 50); // only the newest 50 are new
    expect(calls).toEqual([1]);
  });
});
