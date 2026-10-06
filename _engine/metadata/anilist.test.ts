import { describe, expect, it } from "vitest";
import { combine } from "./anilist.ts";

describe("AniList extras for anime", () => {
  it("keeps strong Demographic/Theme/Setting tags, drops cast and incidental ones, weights the score", () => {
    const r = combine([
      {
        averageScore: 90,
        popularity: 300,
        genres: ["Action", "Fantasy"],
        tags: [
          { name: "Shounen", rank: 95, category: "Demographic" },
          { name: "Isekai", rank: 88, category: "Theme-Fantasy" },
          { name: "Male Protagonist", rank: 99, category: "Cast-Main Cast" },
          { name: "Heterosexual", rank: 70, category: "Sexual Content" },
          { name: "Swordplay", rank: 40, category: "Theme-Action" },
          { name: "Big Twist", rank: 90, category: "Theme-Other", isMediaSpoiler: true },
        ],
      },
      {
        averageScore: 60,
        popularity: 100,
        genres: ["Romance"],
        tags: [{ name: "Urban", rank: 70, category: "Setting-Universe" }],
      },
    ]);
    expect(r.genres).toEqual(["Action", "Fantasy", "Romance"]);
    expect(r.tags).toEqual(["Shounen", "Isekai", "Urban"]);
    expect(r.score).toBe(8.3); // (90×300 + 60×100) / 400 = 82.5 → 8.3 out of 10
  });
});
