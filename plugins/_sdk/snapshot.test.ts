import { describe, expect, it } from "vitest";
import { diffSnapshot, type Entry } from "./snapshot.ts";

const movie = (over: Partial<Entry> = {}): Entry => ({
  id: "m1",
  media: { kind: "movie", tmdb: 603 },
  played: false,
  playCount: 0,
  lastPlayed: "2026-10-06T01:00:00.000Z",
  ...over,
});
const episode = (over: Partial<Entry> = {}): Entry => ({
  id: "e1",
  media: { kind: "show", tmdb: 95396 },
  season: 1,
  episode: 1,
  played: false,
  playCount: 0,
  ...over,
});

describe("snapshot diff", () => {
  it("first sync: played items count once, no unmarks", () => {
    const r = diffSnapshot([movie({ played: true, playCount: 3 }), episode()], null);
    expect(r.events.map((e) => e.kind)).toEqual(["watched"]);
  });

  it("reports a re-watch, an unmark and a new position", () => {
    const a = diffSnapshot([movie({ played: true, playCount: 1 }), episode({ played: true, playCount: 1 })], null);
    const b = diffSnapshot(
      [movie({ played: true, playCount: 2 }), episode({ played: false, position: 0.4 })],
      a.cursor,
      "2026-10-06T02:00:00.000Z",
    );
    expect(b.events.map((e) => [e.kind, e.episode ?? null, e.progress ?? null])).toEqual([
      ["watched", null, null],
      ["unwatched", 1, null],
      ["progress", 1, 0.4],
    ]);
  });

  it("doesn't repeat an unchanged position", () => {
    const a = diffSnapshot([movie({ position: 0.25 })], null);
    expect(diffSnapshot([movie({ position: 0.25 })], a.cursor).events).toEqual([]);
  });
});
