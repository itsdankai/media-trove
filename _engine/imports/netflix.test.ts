import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../db.ts";
import { eventsFor, project } from "../events.ts";
import { createLibrary } from "../library.ts";
import type { MediaInfo, MetadataProvider } from "../metadata/types.ts";
import { dateReader, parseNetflix, splitTitle } from "./netflix.ts";
import { createImports, type ImportJob } from "./runner.ts";

const file = (name: string, text: string) => ({ name, text });

describe("Netflix titles", () => {
  it("splits show, season and episode; Limited Series is season 1; a title without parts is a movie", () => {
    expect(splitTitle("Stranger Things: Season 4: Chapter Seven: The Massacre at Hawkins Lab")).toEqual({
      kind: "episode",
      show: "Stranger Things",
      season: 4,
      episode: "Chapter Seven: The Massacre at Hawkins Lab",
      full: "Stranger Things: Season 4: Chapter Seven: The Massacre at Hawkins Lab",
    });
    expect(splitTitle("Adolescence: Limited Series: Episode 2")).toMatchObject({
      show: "Adolescence",
      season: 1,
      episode: "Episode 2",
    });
    expect(splitTitle("Money Heist: Part 5: Episode 3")).toMatchObject({ show: "Money Heist", season: 5 });
    expect(splitTitle("The Irishman")).toEqual({ kind: "movie", title: "The Irishman" });
    expect(splitTitle("Stranger Things: Stranger Things 4: Chapter One: The Hellfire Club")).toMatchObject({
      show: "Stranger Things",
      season: 4,
      episode: "Chapter One: The Hellfire Club",
    });
    // No season marker: tried as an episode, with the full title kept to try as a movie.
    expect(splitTitle("Glass Onion: A Knives Out Mystery")).toMatchObject({
      kind: "episode",
      season: null,
      full: "Glass Onion: A Knives Out Mystery",
    });
  });

  it("reads dates month-first, or day-first when the file shows it", () => {
    expect(dateReader(["10/5/26", "1/2/26"])("10/5/26")).toBe("2026-10-05T12:00:00.000Z");
    expect(dateReader(["25/12/2025", "5/10/2026"])("5/10/2026")).toBe("2026-10-05T12:00:00.000Z");
  });
});

describe("Netflix files", () => {
  it("the simple CSV: every row is a viewing", () => {
    const p = parseNetflix([
      file(
        "NetflixViewingHistory.csv",
        'Title,Date\n"Stranger Things: Season 4: Chapter One",10/5/26\nThe Irishman,9/30/26\n',
      ),
    ]);
    expect(p.events).toHaveLength(2);
    expect(p.events[0]).toMatchObject({
      media: { kind: "show", title: "Stranger Things" },
      season: 4,
      episodeTitle: "Chapter One",
    });
  });

  const activity = `Profile Name,Start Time,Duration,Attributes,Title,Supplemental Video Type,Device Type,Bookmark,Latest Bookmark,Country
Me,2026-10-05 21:14:03,00:48:10,,Stranger Things: Season 4: Chapter One,,Chrome PC,00:48:10,00:48:10,US (United States)
Me,2026-10-05 20:00:00,00:01:30,,Stranger Things: Season 4: Chapter Two,,Chrome PC,00:01:30,00:01:30,US (United States)
Me,2026-10-05 19:58:00,00:02:00,,Stranger Things: Season 5 (Trailer),TRAILER,Chrome PC,00:02:00,00:02:00,US (United States)
Kids,2026-10-04 10:00:00,00:20:00,,Bluey: Season 1: Magic Xylophone,,TV,00:20:00,00:20:00,US (United States)
`;

  it("the data request: one profile, trailers and short plays left out", () => {
    const p = parseNetflix([file("CONTENT_INTERACTION/ViewingActivity.csv", activity)], { profile: "me" });
    expect(p.events).toHaveLength(1);
    expect(p.events[0]).toMatchObject({ occurredAt: "2026-10-05T21:14:03.000Z", episodeTitle: "Chapter One" });
    expect(p.skipped).toBe(2);
  });

  it("several profiles and none chosen: asks which", () => {
    expect(() => parseNetflix([file("ViewingActivity.csv", activity)])).toThrow(/2 profiles \(Me, Kids\)/);
    expect(() => parseNetflix([file("ViewingActivity.csv", activity)], { profile: "Dad" })).toThrow(
      /No profile called "Dad"/,
    );
  });
});

describe("matching Netflix titles", () => {
  const show: MediaInfo = {
    key: "tmdb-show-66732",
    kind: "show",
    title: "Stranger Things",
    year: 2016,
    poster: null,
    overview: null,
    genres: [],
    extra: { seasons: [{ number: 4, name: "Season 4", episodeCount: 2, airDate: null }] },
  };
  const movie: MediaInfo = {
    ...show,
    key: "tmdb-movie-661374",
    kind: "movie",
    title: "Glass Onion: A Knives Out Mystery",
    extra: {},
  };
  const provider: MetadataProvider = {
    kinds: ["movie", "show"],
    search: async () => [],
    details: async (k) => (k === show.key ? show : movie),
    resolve: async (r) =>
      r.kind === "show" && r.title === "Stranger Things"
        ? show.key
        : r.kind === "movie" && r.title === movie.title
          ? movie.key
          : null,
    season: async (_k, n) => [
      { season: n, number: 1, name: "Chapter One: The Hellfire Club", airDate: null, still: null },
      { season: n, number: 2, name: "Chapter Two: Vecna's Curse", airDate: null, still: null },
    ],
  };

  it("finds the episode by its title, and a colon title with no episode as a movie", async () => {
    const db = openDb(":memory:");
    const imports = createImports(db, createLibrary(db, [provider]), {
      dataDir: mkdtempSync(join(tmpdir(), "mt-nf-")),
    });
    const csv =
      'Title,Date\n"Stranger Things: Season 4: Chapter Two: Vecna\'s Curse",10/5/26\n"Glass Onion: A Knives Out Mystery",10/4/26\n';
    const job = imports.start("netflix", "NetflixViewingHistory.csv", async () =>
      parseNetflix([file("NetflixViewingHistory.csv", csv)]),
    );
    for (let i = 0; i < 200 && imports.job(job.id)?.status === "running"; i++)
      await new Promise((r) => setTimeout(r, 5));
    expect((imports.job(job.id) as ImportJob).summary).toMatchObject({ added: 2, unmatched: 0 });
    expect(project("show", eventsFor(db, show.key)).watchedEpisodes).toEqual(["s4e2"]);
    expect(project("movie", eventsFor(db, movie.key)).watchCount).toBe(1);
  });
});
