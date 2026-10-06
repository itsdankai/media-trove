import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { createCalendar } from "./calendar.ts";
import { openDb } from "./db.ts";
import { appendEvents } from "./events.ts";
import { createLibrary } from "./library.ts";
import type { MediaInfo, MetadataProvider } from "./metadata/types.ts";

const base = { year: 2020, poster: null, overview: null, genres: [] as string[] };
const rows: MediaInfo[] = [
  {
    ...base,
    key: "tmdb-show-1",
    kind: "show",
    title: "Daily Soap",
    extra: { status: "Returning Series", nextEpisode: { season: 1, number: 1, airDate: "2026-10-07" } },
  },
  { ...base, key: "tmdb-show-2", kind: "show", title: "Ended Show", extra: { status: "Ended", nextEpisode: null } },
  { ...base, key: "tmdb-show-3", kind: "show", title: "Frieren", genres: ["Animation"], extra: { anime: true } },
  { ...base, key: "tmdb-movie-4", kind: "movie", title: "Your Name", genres: ["Animation"], extra: { anime: true } },
  { ...base, key: "tmdb-movie-5", kind: "movie", title: "Heat", extra: { anime: false } },
  {
    ...base,
    key: "audible-audiobook-B0OLD",
    kind: "audiobook",
    title: "Golden Son",
    extra: { authors: ["Pierce Brown"], language: "english" },
  },
];

const video: MetadataProvider = {
  kinds: ["movie", "show"],
  search: async () => [],
  details: async (k) => rows.find((r) => r.key === k) as MediaInfo,
  season: async (_k, n) =>
    [7, 8, 9, 12, 13].map((d, i) => ({
      season: n,
      number: i + 1,
      name: `Ep ${i + 1}`,
      airDate: `2026-10-${String(d).padStart(2, "0")}`,
      still: null,
    })),
};
const books: MetadataProvider = {
  kinds: ["audiobook"],
  search: async () => [],
  details: async (k) => rows.find((r) => r.key === k) as MediaInfo,
  upcoming: async () => [
    {
      key: "audible-audiobook-B0NEW",
      kind: "audiobook",
      title: "Light Bringer",
      year: 2026,
      poster: null,
      overview: null,
      releaseDate: "2026-11-02",
      series: "Red Rising",
    },
    {
      key: "audible-audiobook-B0OLD",
      kind: "audiobook",
      title: "Golden Son",
      year: 2026,
      poster: null,
      overview: null,
      releaseDate: "2026-11-09",
      series: "Red Rising",
    },
  ],
};

function setup() {
  const db = openDb(":memory:");
  const lib = createLibrary(db, [video, books]);
  for (const r of rows) lib.upsertMedia(r);
  appendEvents(
    db,
    rows.map((r) => ({
      mediaKey: r.key,
      kind: "watched" as const,
      season: r.kind === "show" ? 1 : null,
      episode: r.kind === "show" ? 1 : null,
      source: "manual",
      occurredAt: "2026-10-01T00:00:00.000Z",
    })),
  );
  return { db, lib };
}

describe("calendar rules from the builder's feedback", () => {
  it("a show you only sampled (no finished episode) stays off; a sequel in a franchise you watched shows up", async () => {
    const db = openDb(":memory:");
    const sampled: MediaInfo = {
      ...base,
      key: "tmdb-show-9",
      kind: "show",
      title: "Soap Opera",
      extra: { status: "Returning Series", nextEpisode: { season: 53, number: 254, airDate: "2026-10-07" } },
    };
    const watched: MediaInfo = {
      ...base,
      key: "tmdb-movie-245891",
      kind: "movie",
      title: "John Wick",
      extra: { collection: { id: 404609, name: "John Wick Collection" } },
    };
    const provider: MetadataProvider = {
      ...video,
      details: async (k) => [sampled, watched].find((r) => r.key === k) as MediaInfo,
      collection: async () => ({
        name: "John Wick Collection",
        parts: [
          {
            key: "tmdb-movie-245891",
            kind: "movie",
            title: "John Wick",
            year: 2014,
            poster: null,
            overview: null,
            releaseDate: "2014-10-22",
          },
          {
            key: "tmdb-movie-999",
            kind: "movie",
            title: "John Wick: Chapter 5",
            year: 2026,
            poster: null,
            overview: null,
            releaseDate: "2026-11-20",
          },
        ],
      }),
    };
    const lib = createLibrary(db, [provider, books]);
    lib.upsertMedia(sampled);
    lib.upsertMedia(watched);
    appendEvents(db, [
      {
        mediaKey: sampled.key,
        kind: "progress",
        progress: 0.2,
        season: 52,
        episode: 55,
        source: "stremio",
        occurredAt: "2024-12-22T23:08:32.015Z",
      },
      { mediaKey: watched.key, kind: "watched", source: "manual", occurredAt: "2026-01-01T00:00:00.000Z" },
    ]);
    const list = await createCalendar(db, lib).upcoming(90, new Date("2026-10-06T12:00:00Z"));
    expect(list.map((e) => [e.kind, e.title, e.label])).toEqual([
      ["movie", "John Wick: Chapter 5", "John Wick Collection"],
    ]);
  });
});

describe("phase 7: Anime section and calendar", () => {
  it("anime shows and movies are in Anime, and not on Shows or Movies", async () => {
    const { db } = setup();
    const app = createApp(db, [video, books]);
    const titles = async (q: string) =>
      ((await (await app.request(`/api/library?${q}`)).json()) as { media: { title: string } }[])
        .map((i) => i.media.title)
        .sort();
    expect(await titles("section=anime")).toEqual(["Frieren", "Your Name"]);
    expect(await titles("kind=show")).toEqual(["Daily Soap", "Ended Show"]);
    expect(await titles("kind=movie")).toEqual(["Heat"]);
  });

  it("upcoming episodes of airing shows (the next few per show), and new books by tracked authors", async () => {
    const { db, lib } = setup();
    const list = await createCalendar(db, lib).upcoming(60, new Date("2026-10-06T12:00:00Z"));
    expect(list.map((e) => [e.date, e.title, e.label])).toEqual([
      ["2026-10-07", "Daily Soap", "S1 · E1 · Ep 1"],
      ["2026-10-08", "Daily Soap", "S1 · E2 · Ep 2"],
      ["2026-10-09", "Daily Soap", "S1 · E3 · Ep 3"],
      ["2026-11-02", "Light Bringer", "Red Rising"], // Golden Son is already tracked
    ]);
  });
});
