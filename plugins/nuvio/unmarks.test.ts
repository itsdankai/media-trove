import { describe, expect, it } from "vitest";
import { diffWatched, unwatchedEvent, type WatchedItem } from "./plugin.ts";

const ep = (n: number, at = 1): WatchedItem => ({
  content_id: "tt0118276",
  content_type: "series",
  title: "Buffy",
  season: 1,
  episode: n,
  watched_at: at,
});

describe("nuvio unmarks", () => {
  it("the first sync adds everything and removes nothing", () => {
    const d = diffWatched([ep(1), ep(2)], undefined);
    expect(d.added).toHaveLength(2);
    expect(d.removed).toEqual([]);
  });

  it("finds what was unmarked since last time, and what's new", () => {
    const first = diffWatched([ep(1), ep(2), ep(3)], undefined);
    const second = diffWatched([ep(1), ep(4, 9)], first.keys);
    expect(second.added.map((w) => w.episode)).toEqual([4]);
    expect(second.removed).toEqual(["series|tt0118276|1|2", "series|tt0118276|1|3"]);
    expect(second.removed.flatMap((k) => unwatchedEvent(k, "2026-10-06T00:00:00.000Z"))).toMatchObject([
      { kind: "unwatched", season: 1, episode: 2, media: { kind: "show", imdb: "tt0118276" } },
      { kind: "unwatched", season: 1, episode: 3 },
    ]);
  });

  it("maps a movie unmark too", () => {
    expect(unwatchedEvent("movie|tt0133093||", "2026-10-06T00:00:00.000Z")).toEqual([
      { media: { kind: "movie", imdb: "tt0133093" }, kind: "unwatched", occurredAt: "2026-10-06T00:00:00.000Z" },
    ]);
  });
});
