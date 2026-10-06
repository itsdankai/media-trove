import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { appendEvents, eventsFor, project } from "./events.ts";

const book = "audible-audiobook-B074NBTRGL";
const fold = (progress: number[]) => {
  const db = openDb(":memory:");
  appendEvents(
    db,
    progress.map((p, i) => ({
      mediaKey: book,
      kind: "progress" as const,
      progress: p,
      source: "audiobookshelf",
      occurredAt: new Date(2026, 9, 5, 20, i).toISOString(),
    })),
  );
  return project("audiobook", eventsFor(db, book));
};

describe("audiobooks", () => {
  it("count as finished at 99%, since apps often stop just short of the end", () => {
    expect(fold([0.996]).status).toBe("finished");
    expect(fold([0.98]).status).toBe("listening");
  });

  it("go back to listening when a re-listen starts", () => {
    expect(fold([0.997, 0.1])).toMatchObject({ status: "listening", progress: 0.1 });
  });
});
