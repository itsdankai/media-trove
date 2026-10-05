import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { absRequest, assertReadOnly } from "./audiobookshelf/plugin.ts";
import { progressEvent, watchedEvent } from "./nuvio/plugin.ts";
import {
  type Cursor,
  decodeWatched,
  itemEvents,
  type LibraryItem,
  orderVideos,
  parseVideoId,
} from "./stremio/plugin.ts";

describe("audiobookshelf", () => {
  it("allows only read requests", () => {
    expect(() => assertReadOnly("GET", "/api/me")).not.toThrow();
    expect(() => assertReadOnly("GET", "/api/items/li_abc123")).not.toThrow();
    expect(() => assertReadOnly("POST", "/login")).not.toThrow();
    expect(() => assertReadOnly("PATCH", "/api/me/progress/li_abc123")).toThrow(/read-only/);
    expect(() => assertReadOnly("DELETE", "/api/items/li_abc123")).toThrow(/read-only/);
    expect(() => assertReadOnly("POST", "/api/libraries")).toThrow(/read-only/);
    expect(() => assertReadOnly("GET", "/api/users")).toThrow(/read-only/);
  });

  it("refuses a write before any network call", async () => {
    await expect(absRequest("http://127.0.0.1:9", "DELETE", "/api/items/x")).rejects.toThrow(/read-only/);
  });
});

/** Builds a Stremio watched field the way Stremio does: anchor = last watched video. */
function encodeWatched(ids: string[], watched: Set<string>) {
  const bits = new Uint8Array(Math.ceil(ids.length / 8));
  ids.forEach((id, i) => {
    if (watched.has(id)) bits[i >> 3] |= 1 << (i % 8);
  });
  const last = Math.max(0, ...ids.map((id, i) => (watched.has(id) ? i : -1)));
  return `${ids[last]}:${last + 1}:${deflateSync(bits).toString("base64")}`;
}

describe("stremio", () => {
  const vids = (n: number, season = 1) =>
    Array.from({ length: n }, (_, i) => ({ id: `tt1:${season}:${i + 1}`, season, episode: i + 1 }));

  it("orders specials first, then by season and episode", () => {
    const order = orderVideos([
      { id: "tt1:2:1", season: 2, episode: 1 },
      { id: "tt1:1:2", season: 1, episode: 2 },
      { id: "tt1:0:1", season: 0, episode: 1 },
      { id: "tt1:1:1", season: 1, episode: 1 },
    ]);
    expect(order).toEqual(["tt1:0:1", "tt1:1:1", "tt1:1:2", "tt1:2:1"]);
  });

  it("decodes the watched bitfield", () => {
    const ids = orderVideos(vids(10));
    const watched = new Set(["tt1:1:1", "tt1:1:2", "tt1:1:5"]);
    expect(decodeWatched(encodeWatched(ids, watched), ids)).toEqual(["tt1:1:1", "tt1:1:2", "tt1:1:5"]);
  });

  it("realigns when episodes were added before the anchor (a new special)", () => {
    const before = orderVideos(vids(6));
    const field = encodeWatched(before, new Set(["tt1:1:1", "tt1:1:3"]));
    const after = orderVideos([{ id: "tt1:0:1", season: 0, episode: 1 }, ...vids(6)]);
    expect(decodeWatched(field, after)).toEqual(["tt1:1:1", "tt1:1:3"]);
  });

  it("returns nothing if the anchor episode disappeared", () => {
    const field = encodeWatched(orderVideos(vids(3)), new Set(["tt1:1:3"]));
    expect(decodeWatched(field, orderVideos(vids(2)))).toEqual([]);
  });

  it("parses video ids", () => {
    expect(parseVideoId("tt0903747:5:14")).toEqual({ imdb: "tt0903747", season: 5, episode: 14 });
    expect(parseVideoId("tt0133093")).toBeNull();
  });

  const movie = (timesWatched: number, timeOffset = 0, lastWatched = "2026-10-05T20:00:00.000Z"): LibraryItem => ({
    _id: "tt0133093",
    name: "The Matrix",
    type: "movie",
    removed: false,
    temp: false,
    _mtime: lastWatched,
    state: { lastWatched, timeOffset, duration: 8_160_000, timesWatched, flaggedWatched: 0 },
  });

  it("reports a watched movie once, then only new viewings", async () => {
    const cursor: Cursor = { since: "", counts: {}, episodes: {} };
    const first = await itemEvents(movie(3), cursor);
    expect(first.filter((e) => e.kind === "watched")).toHaveLength(1); // history before MediaTrove counts once
    const again = await itemEvents(movie(3, 1_000_000, "2026-10-06T20:00:00.000Z"), cursor);
    expect(again.filter((e) => e.kind === "watched")).toHaveLength(0); // a rewatch in progress isn't a new watch
    expect(again.find((e) => e.kind === "progress")?.progress).toBeCloseTo(0.1225, 3);
    const more = await itemEvents(movie(4, 0, "2026-10-07T20:00:00.000Z"), cursor);
    expect(more.filter((e) => e.kind === "watched")).toHaveLength(1);
  });

  it("reports newly watched episodes and the current episode's progress", async () => {
    const videos = vids(5);
    const ids = orderVideos(videos);
    const cursor: Cursor = { since: "", counts: {}, episodes: {} };
    const series = (watched: string[], videoId: string, offset: number): LibraryItem => ({
      _id: "tt1",
      name: "Show",
      type: "series",
      removed: false,
      temp: false,
      _mtime: "2026-10-05T20:00:00.000Z",
      state: {
        lastWatched: "2026-10-05T20:00:00.000Z",
        timeOffset: offset,
        duration: 1000,
        timesWatched: 0,
        flaggedWatched: 0,
        video_id: videoId,
        watched: encodeWatched(ids, new Set(watched)),
      },
    });
    const a = await itemEvents(series(["tt1:1:1", "tt1:1:2"], "tt1:1:3", 400), cursor, async () => videos);
    expect(a.filter((e) => e.kind === "watched").map((e) => e.episode)).toEqual([1, 2]);
    expect(a.find((e) => e.kind === "progress")).toMatchObject({ season: 1, episode: 3, progress: 0.4 });
    const b = await itemEvents(series(["tt1:1:1", "tt1:1:2", "tt1:1:3"], "tt1:1:4", 0), cursor, async () => videos);
    expect(b.map((e) => e.episode)).toEqual([3]);
  });
});

describe("nuvio", () => {
  it("maps watched items and progress rows", () => {
    expect(
      watchedEvent({
        content_id: "tt0133093",
        content_type: "movie",
        title: "The Matrix",
        season: null,
        episode: null,
        watched_at: 1_791_000_000_000,
      }),
    ).toEqual([
      {
        media: { kind: "movie", imdb: "tt0133093", title: "The Matrix" },
        kind: "watched",
        occurredAt: new Date(1_791_000_000_000).toISOString(),
      },
    ]);
    expect(
      watchedEvent({
        content_id: "tt11280740",
        content_type: "series",
        title: "Severance",
        season: 1,
        episode: 3,
        watched_at: 1,
      })[0],
    ).toMatchObject({
      media: { kind: "show", imdb: "tt11280740" },
      season: 1,
      episode: 3,
    });
    const p = progressEvent({
      content_id: "tt11280740",
      content_type: "series",
      video_id: "tt11280740:1:4",
      season: 1,
      episode: 4,
      position: 1_500_000,
      duration: 3_000_000,
      last_watched: 5,
    });
    expect(p[0]).toMatchObject({ kind: "progress", season: 1, episode: 4, progress: 0.5 });
  });

  it("skips content it can't match", () => {
    expect(
      watchedEvent({
        content_id: "kitsu:123",
        content_type: "series",
        title: "x",
        season: 1,
        episode: 1,
        watched_at: 1,
      }),
    ).toEqual([]);
    expect(
      progressEvent({
        content_id: "tt1",
        content_type: "movie",
        video_id: "tt1",
        season: null,
        episode: null,
        position: 0,
        duration: 100,
        last_watched: 1,
      }),
    ).toEqual([]);
  });
});

describe("audiobookshelf progress", () => {
  it("uses position over the stored progress, which can lag", async () => {
    const { bookProgress } = await import("./audiobookshelf/plugin.ts");
    expect(bookProgress({ progress: 0.4, currentTime: 420, duration: 600, isFinished: false })).toBe(0.7);
    expect(bookProgress({ progress: 0.4, isFinished: false })).toBe(0.4);
    expect(bookProgress({ progress: 0.2, currentTime: 10, duration: 600, isFinished: true })).toBe(1);
  });
});
