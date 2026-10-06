import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeWatched, encodeWatched, type LibraryItem, orderVideos, pushToStremio, type Video } from "./plugin.ts";

const videos: Video[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => ({ id: `tt1:1:${n}`, season: 1, episode: n }));
const ids = orderVideos(videos);

describe("Stremio watched bitfield, written", () => {
  it("round-trips through the reader, anchored on the last watched episode", () => {
    const s = encodeWatched(new Set(["tt1:1:2", "tt1:1:9"]), ids);
    expect(s.startsWith("tt1:1:9:9:")).toBe(true);
    expect(decodeWatched(s, ids)).toEqual(["tt1:1:2", "tt1:1:9"]);
  });

  it("nothing watched still makes a readable value", () => {
    expect(decodeWatched(encodeWatched(new Set(), ids), ids)).toEqual([]);
  });
});

describe("pushing to Stremio", () => {
  afterEach(() => vi.unstubAllGlobals());

  const series: LibraryItem = {
    _id: "tt1",
    name: "Show",
    type: "series",
    removed: false,
    temp: false,
    _mtime: "2026-01-01T00:00:00.000Z",
    state: {
      lastWatched: "2026-01-01T00:00:00.000Z",
      timeOffset: 0,
      duration: 0,
      timesWatched: 0,
      flaggedWatched: 0,
      watched: encodeWatched(new Set(["tt1:1:1"]), ids),
    },
  };

  function stub() {
    const puts: { changes: LibraryItem[] }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      if (url.endsWith("/datastoreGet"))
        return new Response(JSON.stringify({ result: body.ids.includes("tt1") ? [series] : [] }));
      if (url.endsWith("/datastorePut")) {
        puts.push(body);
        return new Response(JSON.stringify({ result: { success: true } }));
      }
      throw new Error(`unexpected ${url}`);
    });
    return puts;
  }

  it("adds an episode to the show's watched list and keeps the ones already there", async () => {
    const puts = stub();
    const r = await pushToStremio(
      { authKey: "k" },
      [
        {
          media: { kind: "show", imdb: "tt1" },
          action: "watched",
          season: 1,
          episode: 3,
          occurredAt: "2026-10-06T08:00:00.000Z",
        },
        { media: { kind: "movie", imdb: "tt999" }, action: "watched", occurredAt: "2026-10-06T08:00:00.000Z" },
      ],
      async () => videos,
    );
    expect(r.results).toEqual([{ ok: true }, { ok: false, notFound: true }]);
    const saved = puts[0].changes[0];
    expect(decodeWatched(saved.state.watched as string, ids)).toEqual(["tt1:1:1", "tt1:1:3"]);
    expect(saved.state.lastWatched).toBe("2026-10-06T08:00:00.000Z");
    expect(saved._mtime > series._mtime).toBe(true);
  });

  it("an episode Stremio doesn't list is not found, and nothing is saved", async () => {
    const puts = stub();
    const r = await pushToStremio(
      { authKey: "k" },
      [
        {
          media: { kind: "show", imdb: "tt1" },
          action: "watched",
          season: 9,
          episode: 1,
          occurredAt: "2026-10-06T08:00:00.000Z",
        },
      ],
      async () => videos,
    );
    expect(r.results).toEqual([{ ok: false, notFound: true }]);
    expect(puts).toEqual([]);
  });
});
