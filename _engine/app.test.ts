import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { appendEvents, eventId, type NewEvent } from "./events.ts";
import type { MediaInfo, MetadataProvider } from "./metadata/types.ts";

const fakeInfo: Record<string, MediaInfo> = {
  "tmdb-movie-603": {
    key: "tmdb-movie-603",
    kind: "movie",
    title: "The Matrix",
    year: 1999,
    poster: null,
    overview: null,
    genres: ["Action"],
    extra: {},
  },
  "tmdb-show-95396": {
    key: "tmdb-show-95396",
    kind: "show",
    title: "Severance",
    year: 2022,
    poster: null,
    overview: null,
    genres: ["Drama"],
    extra: { totalEpisodes: 19, airedEpisodes: 3 },
  },
  "audible-audiobook-B08G9PRS1K": {
    key: "audible-audiobook-B08G9PRS1K",
    kind: "audiobook",
    title: "Project Hail Mary",
    year: 2021,
    poster: null,
    overview: null,
    genres: ["Science Fiction & Fantasy"],
    extra: { runtimeMin: 970 },
  },
};

const fake: MetadataProvider = {
  kinds: ["movie", "show", "audiobook"],
  search: async (kind) => Object.values(fakeInfo).filter((m) => m.kind === kind),
  details: async (key) => fakeInfo[key],
};

function setup(file = ":memory:") {
  const db = openDb(file);
  return { db, app: createApp(db, [fake]) };
}

const post = (app: ReturnType<typeof setup>["app"], body: unknown) =>
  app.request("/api/events", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });

describe("event log", () => {
  const e: NewEvent = {
    mediaKey: "tmdb-movie-603",
    kind: "watched",
    source: "manual",
    occurredAt: "2026-10-05T20:00:00.000Z",
  };

  it("stores the same event only once", () => {
    const { db } = setup();
    expect(appendEvents(db, [e]).inserted).toBe(1);
    expect(appendEvents(db, [e]).inserted).toBe(0);
    expect(appendEvents(db, [{ ...e }, { ...e }]).inserted).toBe(0);
  });

  it("gives different events different ids", () => {
    expect(eventId(e)).not.toBe(eventId({ ...e, occurredAt: "2026-10-05T21:00:00.000Z" }));
    expect(eventId(e)).not.toBe(eventId({ ...e, source: "stremio" }));
  });
});

describe("api", () => {
  it("tracks a movie, three episodes, and audiobook progress", async () => {
    const { app } = setup();
    expect((await post(app, { mediaKey: "tmdb-movie-603", kind: "watched" })).status).toBe(201);
    await post(
      app,
      [1, 2, 3].map((n) => ({ mediaKey: "tmdb-show-95396", kind: "watched", season: 1, episode: n })),
    );
    await post(app, { mediaKey: "audible-audiobook-B08G9PRS1K", kind: "progress", progress: 0.4 });

    const lib = (await (await app.request("/api/library")).json()) as {
      media: { key: string };
      state: Record<string, unknown>;
    }[];
    const by = Object.fromEntries(lib.map((i) => [i.media.key, i.state]));
    expect(by["tmdb-movie-603"]).toMatchObject({ status: "completed", watchCount: 1 });
    expect(by["tmdb-show-95396"]).toMatchObject({ status: "completed" }); // 3 of 3 aired; more announced but undated
    expect(by["tmdb-show-95396"].watchedEpisodes).toHaveLength(3);
    expect(by["audible-audiobook-B08G9PRS1K"]).toMatchObject({ status: "listening", progress: 0.4 });

    const history = (await (await app.request("/api/history")).json()) as unknown[];
    expect(history).toHaveLength(5);
  });

  it("unwatching an episode and finishing a book update the state", async () => {
    const { app } = setup();
    await post(app, [
      { mediaKey: "tmdb-show-95396", kind: "watched", season: 1, episode: 1, occurredAt: "2026-10-01T00:00:00Z" },
      { mediaKey: "tmdb-show-95396", kind: "unwatched", season: 1, episode: 1, occurredAt: "2026-10-02T00:00:00Z" },
      { mediaKey: "audible-audiobook-B08G9PRS1K", kind: "finished", occurredAt: "2026-10-03T00:00:00Z" },
    ]);
    const lib = (await (await app.request("/api/library")).json()) as {
      media: { key: string };
      state: Record<string, unknown>;
    }[];
    const by = Object.fromEntries(lib.map((i) => [i.media.key, i.state]));
    expect(by["tmdb-show-95396"]).toBeUndefined(); // nothing left watched: not listed (no watchlist yet)
    expect(by["audible-audiobook-B08G9PRS1K"]).toMatchObject({ status: "finished", progress: 1 });
  });

  it("filters the library by kind and rejects bad input", async () => {
    const { app } = setup();
    await post(app, { mediaKey: "tmdb-movie-603", kind: "watched" });
    await post(app, { mediaKey: "audible-audiobook-B08G9PRS1K", kind: "progress", progress: 0.1 });
    const movies = (await (await app.request("/api/library?kind=movie")).json()) as unknown[];
    expect(movies).toHaveLength(1);
    expect((await post(app, { mediaKey: "tmdb-movie-603", kind: "progress", progress: 2 })).status).toBe(400);
    expect((await app.request("/api/search?kind=book&q=x")).status).toBe(400);
  });

  it("keeps history in the database file across restarts", async () => {
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const file = join(tmpdir(), `mediatrove-test-${Date.now()}.db`);
    const first = setup(file);
    await post(first.app, { mediaKey: "tmdb-movie-603", kind: "watched" });
    const second = setup(file);
    const lib = (await (await second.app.request("/api/library")).json()) as unknown[];
    expect(lib).toHaveLength(1);
  });
});

describe("watchlist (2026-10-07)", () => {
  type Lib = { media: { key: string }; state: { status: string }; watchlistedAt: number | null }[];
  const library = async (app: ReturnType<typeof setup>["app"]) =>
    (await (await app.request("/api/library")).json()) as Lib;

  it("a saved title shows as planned until it's started, then moves on by itself", async () => {
    const { app } = setup();
    expect((await app.request("/api/watchlist/tmdb-movie-603", { method: "PUT" })).status).toBe(200);
    let lib = await library(app);
    expect(lib).toHaveLength(1);
    expect(lib[0]).toMatchObject({ state: { status: "planned" } });
    expect(lib[0].watchlistedAt).toBeTypeOf("number");
    expect(
      ((await (await app.request("/api/media/tmdb-movie-603")).json()) as { watchlisted: boolean }).watchlisted,
    ).toBe(true);

    await post(app, { mediaKey: "tmdb-movie-603", kind: "watched" });
    lib = await library(app);
    expect(lib[0].state.status).toBe("completed");
  });

  it("a title the metadata source doesn't know is not found, not a server error", async () => {
    const { app } = setup();
    expect((await app.request("/api/watchlist/audible-audiobook-B0NOTREAL1", { method: "PUT" })).status).toBe(404);
  });

  it("removing it takes it off; a title never saved and never watched isn't listed", async () => {
    const { app } = setup();
    await app.request("/api/watchlist/tmdb-show-95396", { method: "PUT" });
    await app.request("/api/watchlist/tmdb-show-95396", { method: "DELETE" });
    expect(await library(app)).toHaveLength(0);
  });
});
