import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { type Cursor, itemEvents, type LibraryItem, orderVideos } from "./plugin.ts";

const videos = Array.from({ length: 4 }, (_, i) => ({ id: `tt1:1:${i + 1}`, season: 1, episode: i + 1 }));
const ids = orderVideos(videos);

/** Stremio's watched field: anchor = last watched video (or the first when none are). */
function field(watched: string[]) {
  const bits = new Uint8Array(1);
  ids.forEach((id, i) => {
    if (watched.includes(id)) bits[0] |= 1 << i;
  });
  const last = Math.max(0, ...ids.map((id, i) => (watched.includes(id) ? i : -1)));
  return `${ids[last]}:${last + 1}:${deflateSync(bits).toString("base64")}`;
}

const series = (watched: string[]): LibraryItem => ({
  _id: "tt1",
  name: "Show",
  type: "series",
  removed: false,
  temp: false,
  _mtime: "2026-10-06T00:00:00Z",
  state: { timeOffset: 0, duration: 0, timesWatched: 0, flaggedWatched: 0, watched: field(watched) },
});

const movie = (timesWatched: number): LibraryItem => ({
  _id: "tt2",
  name: "Movie",
  type: "movie",
  removed: true,
  temp: true,
  _mtime: "2026-10-06T00:00:00Z",
  state: { timeOffset: 0, duration: 100, timesWatched, flaggedWatched: 0 },
});

describe("stremio unmarks", () => {
  it("reports episodes that were unmarked", async () => {
    const cursor: Cursor = { since: "", counts: {}, episodes: {}, retry: [] };
    await itemEvents(series(["tt1:1:1", "tt1:1:2", "tt1:1:3"]), cursor, async () => videos);
    const after = await itemEvents(series(["tt1:1:1"]), cursor, async () => videos);
    expect(after.map((e) => [e.kind, e.episode])).toEqual([
      ["unwatched", 2],
      ["unwatched", 3],
    ]);
  });

  it("reports a whole series unmarked (all bits cleared)", async () => {
    const cursor: Cursor = { since: "", counts: {}, episodes: {}, retry: [] };
    await itemEvents(series(["tt1:1:1"]), cursor, async () => videos);
    const after = await itemEvents(series([]), cursor, async () => videos);
    expect(after).toMatchObject([{ kind: "unwatched", episode: 1 }]);
  });

  it("reports nothing when the episode list can't be read", async () => {
    const cursor: Cursor = { since: "", counts: {}, episodes: {}, retry: [] };
    await itemEvents(series(["tt1:1:1", "tt1:1:2"]), cursor, async () => videos);
    const unreadable = await itemEvents(series(["tt1:1:1", "tt1:1:2"]), cursor, async () => []);
    expect(unreadable).toEqual([]);
    expect(cursor.episodes.tt1).toEqual(["tt1:1:1", "tt1:1:2"]); // memory kept for next time
  });

  it("reports a movie unmarked when its count drops to zero", async () => {
    const cursor: Cursor = { since: "", counts: {}, episodes: {}, retry: [] };
    await itemEvents(movie(1), cursor);
    expect((await itemEvents(movie(0), cursor)).map((e) => e.kind)).toEqual(["unwatched"]);
    expect((await itemEvents(movie(1), cursor)).map((e) => e.kind)).toEqual(["watched"]); // watched again later
  });
});
