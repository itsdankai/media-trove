import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { openDb } from "../db.ts";
import { appendEvents, eventsFor, project } from "../events.ts";
import { createLibrary } from "../library.ts";
import { type MediaInfo, type MetadataProvider, makeKey } from "../metadata/types.ts";
import { animeEvents, buildIndex } from "./anime.ts";
import { parseAniList, parseMal } from "./anime-lists.ts";
import { parseImdb, parseLetterboxd } from "./csv-exports.ts";
import { parseCsv, readUpload } from "./files.ts";
import { createImports, type ImportJob } from "./runner.ts";
import { parseSimkl } from "./simkl.ts";
import { parseTrakt } from "./trakt.ts";

const file = (name: string, data: unknown) => ({ name, text: typeof data === "string" ? data : JSON.stringify(data) });

// --- samples, shaped like the real exports ---------------------------------------------------

const traktHistory = [
  {
    id: 1,
    watched_at: "2024-03-01T20:00:00.000Z",
    action: "watch",
    type: "movie",
    movie: { title: "The Matrix", year: 1999, ids: { trakt: 481, imdb: "tt0133093", tmdb: 603 } },
  },
  {
    id: 2,
    watched_at: "2025-03-01T20:00:00.000Z",
    action: "watch",
    type: "movie",
    movie: { title: "The Matrix", year: 1999, ids: { trakt: 481, imdb: "tt0133093", tmdb: 603 } },
  },
  {
    id: 3,
    watched_at: "2024-04-01T21:00:00.000Z",
    action: "scrobble",
    type: "episode",
    episode: { season: 1, number: 2, title: "Half Loop", ids: { trakt: 9 } },
    show: { title: "Severance", year: 2022, ids: { trakt: 1, tvdb: 371980, imdb: "tt11280740", tmdb: 95396 } },
  },
  { id: 4, action: "watch", type: "movie", movie: { title: "No date", ids: { tmdb: 1 } } },
];

const letterboxdDiary = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-05-02,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/a,4.5,,,2024-05-01
2025-01-10,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/b,5,Yes,,2025-01-09
`;
const letterboxdWatched = `Date,Name,Year,Letterboxd URI
2024-05-02,"Crouching Tiger, Hidden Dragon",2000,https://boxd.it/x
2023-02-02,Arrival,2016,https://boxd.it/y
`;

const imdbRatings = `Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors
tt0133093,9,2024-01-05,The Matrix,The Matrix,https://www.imdb.com/title/tt0133093/,Movie,8.7,136,1999,"Action, Sci-Fi",2000000,1999-03-31,"Lana Wachowski, Lilly Wachowski"
tt11280740,9,2024-02-05,Severance,Severance,https://www.imdb.com/title/tt11280740/,TV Series,8.7,55,2022,Drama,300000,2022-02-18,
tt11650328,8,2024-02-06,Half Loop,Half Loop,https://www.imdb.com/title/tt11650328/,TV Episode,8.2,57,2022,Drama,30000,2022-02-18,
`;

const simklAll = {
  movies: [
    {
      status: "completed",
      last_watched_at: "2024-06-01T10:00:00Z",
      movie: { title: "Arrival", year: 2016, ids: { simkl: 5, tmdb: 329865 } },
    },
    { status: "plantowatch", movie: { title: "Dune", year: 2021, ids: { tmdb: 438631 } } },
  ],
  shows: [
    {
      status: "watching",
      show: { title: "Severance", year: 2022, ids: { tmdb: 95396 } },
      seasons: [
        {
          number: 1,
          episodes: [
            { number: 1, watched_at: "2024-04-01T20:00:00Z" },
            { number: 2, watched_at: "2024-04-02T20:00:00Z" },
          ],
        },
      ],
    },
  ],
  anime: [
    {
      status: "completed",
      anime_type: "tv",
      show: { title: "Frieren", year: 2023, ids: { simkl: 2000, mal: 52991 } },
      seasons: [{ number: 1, episodes: [{ number: 1, watched_at: "2024-01-01T20:00:00Z" }] }],
    },
  ],
};

describe("import parsers", () => {
  it("parses CSV with quoted commas, quotes and a BOM-less header", () => {
    expect(parseCsv('a,b\n"x, y","say ""hi"""\r\n')).toEqual([{ a: "x, y", b: 'say "hi"' }]);
  });

  it("unpacks a ZIP export", () => {
    const zip = zipSync({ "trakt/watched-history-1.json": strToU8("[]"), "trakt/readme.txt": strToU8("x") });
    expect(readUpload("export.zip", zip).map((f) => f.name)).toEqual(["trakt/watched-history-1.json"]);
  });

  it("Trakt: one event per play, rewatches included; undated entries skipped", () => {
    const p = parseTrakt([file("watched-history-1.json", traktHistory)]);
    expect(p.events).toHaveLength(3);
    expect(p.skipped).toBe(1);
    expect(p.events[2]).toMatchObject({ season: 1, episode: 2, media: { kind: "show", tmdb: 95396 } });
  });

  it("Trakt: a ZIP without history is turned away with a hint", () => {
    expect(() => parseTrakt([file("ratings-movies.json", [])])).toThrow(/trakt.tv\/settings\/data/);
  });

  it("Letterboxd: diary rows by watched date; watched.csv only adds films with no diary entry", () => {
    const p = parseLetterboxd([file("diary.csv", letterboxdDiary), file("watched.csv", letterboxdWatched)]);
    expect(p.events.map((e) => [e.media.title, e.occurredAt.slice(0, 10)])).toEqual([
      ["Crouching Tiger, Hidden Dragon", "2024-05-01"],
      ["Crouching Tiger, Hidden Dragon", "2025-01-09"],
      ["Arrival", "2023-02-02"],
    ]);
  });

  it("IMDb: rated movies and episodes come in; a rated series is skipped; watchlists are left out", () => {
    const p = parseImdb([
      file("ratings.csv", imdbRatings),
      file("watchlist.csv", "Position,Const,Created\n1,tt1,2024-01-01\n"),
    ]);
    expect(p.events).toHaveLength(2);
    expect(p.events[1].episodeImdb).toBe("tt11650328");
    expect(p.skipped).toBe(1);
    expect(p.notes[0]).toMatch(/watchlist/);
  });

  it("Simkl: completed movies, every watched episode, anime kept for mapping", () => {
    const p = parseSimkl(simklAll);
    expect(p.events).toHaveLength(3);
    expect(p.skipped).toBe(1);
    expect(p.anime[0]).toMatchObject({ ids: { simkl: 2000, mal: 52991 }, episodes: [{ number: 1 }] });
  });

  it("AniList: episodes 1..progress dated by completion; planned entries skipped", () => {
    const p = parseAniList({
      MediaListCollection: {
        lists: [
          {
            entries: [
              {
                status: "COMPLETED",
                progress: 28,
                updatedAt: 1700000000,
                completedAt: { year: 2024, month: 3, day: 22 },
                startedAt: {},
                media: {
                  id: 154587,
                  idMal: 52991,
                  format: "TV",
                  episodes: 28,
                  title: { english: "Frieren" },
                  startDate: { year: 2023 },
                },
              },
              { status: "PLANNING", progress: 0, media: { id: 1, format: "TV", title: {} } },
            ],
          },
        ],
      },
    });
    expect(p.anime[0].episodes).toHaveLength(28);
    expect(p.anime[0].episodes[0].at).toBe("2024-03-22T12:00:00.000Z");
    expect(p.skipped).toBe(1);
  });

  it("MyAnimeList: completed counts the whole show; plan-to-watch skipped", () => {
    const p = parseMal([
      {
        status: 2,
        num_watched_episodes: 10,
        anime_num_episodes: 12,
        anime_id: 5,
        anime_title: "X",
        anime_media_type_string: "TV",
        updated_at: 1700000000,
      },
      {
        status: 6,
        num_watched_episodes: 0,
        anime_id: 6,
        anime_title: "Y",
        anime_media_type_string: "TV",
        updated_at: 1700000000,
      },
    ]);
    expect(p.anime[0].episodes).toHaveLength(12);
    expect(p.skipped).toBe(1);
  });
});

describe("anime mapping", () => {
  const xml = `<anime-list>
  <anime anidbid="100" tvdbid="1" defaulttvdbseason="1" episodeoffset="" tmdbtv="500" tmdbseason="2" tmdboffset="12" tmdbid="" imdbid="">
  <anime anidbid="200" tvdbid="1" defaulttvdbseason="a" episodeoffset="" tmdbtv="600" tmdbseason="a" tmdboffset="" tmdbid="" imdbid="">
  <anime anidbid="300" tvdbid="movie" defaulttvdbseason="" episodeoffset="" tmdbtv="" tmdbseason="" tmdboffset="" tmdbid="128" imdbid="">
</anime-list>`;
  const fribb = [
    { anidb_id: 100, anilist_id: 1001, mal_id: 2001 },
    { anidb_id: 200, anilist_id: 1002 },
    { anidb_id: 300, mal_id: 2003 },
    { anilist_id: 1004, themoviedb_id: { tv: 700 }, season: { tmdb: 3 } },
  ];
  const idx = buildIndex(xml, fribb);
  const sizes = async () => [
    { number: 0, episodeCount: 5 },
    { number: 1, episodeCount: 12 },
    { number: 2, episodeCount: 13 },
  ];
  const entry = (ids: object, n: number, movie = false) => ({
    ids,
    title: "t",
    movie,
    episodes: Array.from({ length: n }, (_, i) => ({ number: i + 1, at: "2024-01-01T00:00:00.000Z" })),
    watchedAt: movie ? "2024-01-01T00:00:00.000Z" : null,
  });

  it("a second cour continues its TMDB season (season and offset)", async () => {
    const evs = await animeEvents(entry({ mal: 2001 }, 2), idx, sizes);
    expect(evs?.map((e) => [e.media.tmdb, e.season, e.episode])).toEqual([
      [500, 2, 13],
      [500, 2, 14],
    ]);
  });

  it("straight-through numbering is split across TMDB seasons (specials left out)", async () => {
    const evs = await animeEvents(entry({ anilist: 1002 }, 14), idx, sizes);
    expect(evs?.at(-1)).toMatchObject({ season: 2, episode: 2 });
  });

  it("movies map to their TMDB movie; Fribb fills gaps; unknown shows aren't guessed", async () => {
    expect((await animeEvents(entry({ mal: 2003 }, 0, true), idx, sizes))?.[0].media).toEqual({
      kind: "movie",
      tmdb: 128,
    });
    expect((await animeEvents(entry({ anilist: 1004 }, 1), idx, sizes))?.[0]).toMatchObject({ season: 3, episode: 1 });
    expect(await animeEvents(entry({ anilist: 9999 }, 3), idx, sizes)).toBeNull();
  });

  it("a show-format entry that TMDB files as a movie counts as watching that movie", async () => {
    const evs = await animeEvents(entry({ anidb: 300 }, 1), idx, sizes);
    expect(evs).toEqual([
      { media: { kind: "movie", tmdb: 128 }, kind: "watched", occurredAt: "2024-01-01T00:00:00.000Z" },
    ]);
  });
});

describe("running an import", () => {
  const movie = makeKey("tmdb", "movie", 603);
  const show = makeKey("tmdb", "show", 95396);
  const info: Record<string, MediaInfo> = {
    [movie]: {
      key: movie,
      kind: "movie",
      title: "The Matrix",
      year: 1999,
      poster: null,
      overview: null,
      genres: [],
      extra: {},
    },
    [show]: {
      key: show,
      kind: "show",
      title: "Severance",
      year: 2022,
      poster: null,
      overview: null,
      genres: [],
      extra: {},
    },
  };
  const provider: MetadataProvider = {
    kinds: ["movie", "show"],
    search: async () => [],
    details: async (k) => info[k],
    resolve: async (r) => (r.tmdb === 603 ? movie : r.tmdb === 95396 ? show : null),
    findEpisode: async (tt) => (tt === "tt11650328" ? { key: show, season: 1, episode: 2 } : null),
  };

  async function finish(job: ImportJob, imports: ReturnType<typeof createImports>) {
    for (let i = 0; i < 200 && imports.job(job.id)?.status === "running"; i++)
      await new Promise((r) => setTimeout(r, 5));
    return imports.job(job.id) as ImportJob;
  }

  it("stores the history once: rerunning the same export adds nothing", async () => {
    const db = openDb(":memory:");
    const dir = mkdtempSync(join(tmpdir(), "mt-import-"));
    writeFileSync(join(dir, "anime-map.json"), JSON.stringify(buildIndex("", [])));
    const imports = createImports(db, createLibrary(db, [provider]), { dataDir: dir });
    const parsed = () => Promise.resolve(parseTrakt([file("watched-history-1.json", traktHistory)]));

    const first = await finish(imports.start("trakt", "export.zip", parsed), imports);
    expect(first.status).toBe("done");
    expect(first.summary).toMatchObject({ received: 3, added: 3, titles: 2, unmatched: 0, skipped: 1 });
    expect(project("movie", eventsFor(db, movie)).watchCount).toBe(2);
    expect(eventsFor(db, movie)[0].source).toBe("import-trakt");

    const again = await finish(imports.start("trakt", "export.zip", parsed), imports);
    expect(again.summary.added).toBe(0);
    expect(imports.history()).toHaveLength(2);

    expect(imports.remove("trakt")).toBe(3);
  });

  it("leaves out a watch a connected app already recorded (same viewing), keeps a real rewatch", async () => {
    const db = openDb(":memory:");
    const dir = mkdtempSync(join(tmpdir(), "mt-import-"));
    // Stremio saw the 2024 Matrix viewing 3 hours before Trakt logged it; the 2025 one only Trakt has.
    appendEvents(db, [{ mediaKey: movie, kind: "watched", source: "stremio", occurredAt: "2024-03-01T17:00:00.000Z" }]);
    const imports = createImports(db, createLibrary(db, [provider]), { dataDir: dir });
    const parsed = () => Promise.resolve(parseTrakt([file("watched-history-1.json", traktHistory)]));
    const job = await finish(imports.start("trakt", "export.zip", parsed), imports);
    expect(job.summary).toMatchObject({ added: 2, alreadyTracked: 1 });
    expect(project("movie", eventsFor(db, movie)).watchCount).toBe(2);
  });

  it("matches IMDb episodes by their own id and reports what didn't match", async () => {
    const db = openDb(":memory:");
    const dir = mkdtempSync(join(tmpdir(), "mt-import-"));
    const imports = createImports(db, createLibrary(db, [provider]), { dataDir: dir });
    const parsed = () => Promise.resolve(parseImdb([file("ratings.csv", imdbRatings)]));
    const job = await finish(imports.start("imdb", "ratings.csv", parsed), imports);
    expect(job.summary).toMatchObject({ added: 1, unmatched: 1 }); // the movie has no tmdb id in this fake
    expect(project("show", eventsFor(db, show)).watchedEpisodes).toEqual(["s1e2"]);
  });
});
