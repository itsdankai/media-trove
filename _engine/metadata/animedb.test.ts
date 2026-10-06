import { describe, expect, it } from "vitest";
import { buildIndex, combine, entryFrom } from "./animedb.ts";

const row = (over: object) =>
  JSON.stringify({
    sources: ["https://anilist.co/anime/101", "https://myanimelist.net/anime/202"],
    title: "Show",
    tags: ["action", "shounen", "male protagonist", "isekai", "science fiction", "primarily teen cast"],
    score: { arithmeticMean: 8.24 },
    ...over,
  });

describe("anime-offline-database", () => {
  it("keeps genres and curated tags, drops cast details", () => {
    expect(entryFrom(JSON.parse(row({})))).toEqual({ g: ["Action", "Sci-Fi"], t: ["Shounen", "Isekai"], s: 8.24 });
  });

  it("indexes each entry by its AniList and MAL ids", () => {
    const idx = buildIndex(`{"$schema":"x"}\n${row({})}\n`);
    expect(idx.byAnilist[101]).toEqual(idx.byMal[202]);
    expect(idx.malToAnilist[202]).toBe(101); // the MAL import's fallback, offline
  });

  it("seasons combine: tags and genres joined, scores averaged to one decimal", () => {
    const r = combine([
      { g: ["Action"], t: ["Shounen"], s: 8.2 },
      { g: ["Drama"], t: ["Shounen", "Military"], s: 8.7 },
    ]);
    expect(r).toMatchObject({ genres: ["Action", "Drama"], tags: ["Shounen", "Military"], score: 8.5 });
  });
});
