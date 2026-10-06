import { describe, expect, it } from "vitest";
import { baseTitle, partOf, pickEdition } from "./audible.ts";

// Shaped like real Audible results for these searches (checked 2026-10-05).
const products = [
  { asin: "B00I2VWW5U", title: "Morning Star", publisher_name: "Recorded Books" },
  {
    asin: "B0CTWQ44B4",
    title: "Morning Star (Part 1 of 2) (Dramatized Adaptation)",
    publisher_name: "Graphic Audio LLC",
  },
  { asin: "B0D5DKK1VS", title: "Morning Star (2 of 2) (Dramatized Adaptation)", publisher_name: "GraphicAudio" },
  { asin: "B0XXXXXXXX", title: "Morning Star Rising", publisher_name: "Other" },
];

describe("audible edition by year", () => {
  const rr = [
    { asin: "B00I2VWW5U", title: "Red Rising", publisher_name: "Recorded Books", release_date: "2014-01-28" },
    {
      asin: "B0BVGTFDWN",
      title: "Red Rising (Part 1 of 2) (Dramatized Adaptation)",
      publisher_name: "Graphic Audio LLC",
      release_date: "2023-04-03",
    },
    {
      asin: "B0C4LSXHPG",
      title: "Red Rising (Part 2 of 2) (Dramatized Adaptation)",
      publisher_name: "Graphic Audio LLC",
      release_date: "2023-05-17",
    },
  ];
  it("doesn't mistake a spin-off that starts with the same words for the book", () => {
    const withSpinoff = [
      ...rr,
      {
        asin: "1648814948",
        title: "Red Rising: Sons Of Ares Volume 1 [Dramatized Adaptation]",
        publisher_name: "GraphicAudio",
        release_date: "2021-01-02",
      },
    ];
    expect(pickEdition({ title: "Red Rising", year: 2023 }, withSpinoff)).toEqual(["B0BVGTFDWN", "B0C4LSXHPG"]);
  });

  it("matches titles that have the series folded in", () => {
    const ef = [
      { asin: "B07Q1", title: "Match Game", publisher_name: "Podium Audio", release_date: "2021-07-27" },
      { asin: "B07Q2", title: "Breakaway", publisher_name: "Podium Audio", release_date: "2021-02-02" },
    ];
    expect(pickEdition({ title: "Match Game: Expeditionary Force, Book 14" }, ef)).toEqual(["B07Q1"]);
    expect(pickEdition({ title: "Expeditionary Force, Book 12 - Breakaway" }, ef)).toEqual(["B07Q2"]);
  });

  it("uses the release year when nothing else names the edition", () => {
    expect(pickEdition({ title: "Red Rising", year: 2023 }, rr)).toEqual(["B0BVGTFDWN", "B0C4LSXHPG"]);
    expect(pickEdition({ title: "Red Rising", year: 2014 }, rr)).toEqual(["B00I2VWW5U"]);
    expect(pickEdition({ title: "Red Rising" }, rr)).toEqual(["B00I2VWW5U"]);
  });
});

describe("audible edition matching", () => {
  it("strips edition and part markers from titles", () => {
    expect(baseTitle("Iron Gold: [Dramatized Adaptation]")).toBe("Iron Gold");
    expect(baseTitle("Morning Star (Part 1 of 2) (Dramatized Adaptation)")).toBe("Morning Star");
    expect(partOf("Dark Age (3 of 3) [Dramatized Adaptation]")).toEqual({ n: 3, of: 3 });
    expect(partOf("Golden Son (Part 1 of 2)")).toEqual({ n: 1, of: 2 });
    expect(partOf("Red Rising")).toBeNull();
  });

  it("a merged dramatized copy maps to every part, in order", () => {
    expect(pickEdition({ title: "Morning Star: [Dramatized Adaptation]" }, products)).toEqual([
      "B0CTWQ44B4",
      "B0D5DKK1VS",
    ]);
  });

  it("a named part maps to just that part", () => {
    expect(pickEdition({ title: "Morning Star (Part 2 of 2) [Dramatized Adaptation]" }, products)).toEqual([
      "B0D5DKK1VS",
    ]);
  });

  it("the publisher or narrator can identify the edition when the title doesn't", () => {
    expect(pickEdition({ title: "Morning Star", publisher: "GraphicAudio" }, products)).toEqual([
      "B0CTWQ44B4",
      "B0D5DKK1VS",
    ]);
  });

  it("a normal copy never matches the dramatization", () => {
    expect(pickEdition({ title: "Morning Star", publisher: "Recorded Books" }, products)).toEqual(["B00I2VWW5U"]);
  });

  it("a dramatized copy with no dramatized edition on Audible stays unmatched rather than wrong", () => {
    expect(pickEdition({ title: "Morning Star [Dramatized Adaptation]" }, [products[0]])).toEqual([]);
  });
});
