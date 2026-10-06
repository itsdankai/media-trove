import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { appendEvents, eventsFor, project } from "./events.ts";

describe("same-instant events", () => {
  it("'watched' beats a stale position reported at the same moment (Stremio's mark-as-watched)", () => {
    const db = openDb(":memory:");
    const at = "2026-10-05T23:50:46.332Z";
    const key = "tmdb-movie-569094";
    // Stored in the unlucky order: progress after watched.
    appendEvents(db, [
      { mediaKey: key, kind: "watched", source: "stremio", occurredAt: at },
      { mediaKey: key, kind: "progress", progress: 0.29, source: "stremio", occurredAt: at },
    ]);
    expect(project("movie", eventsFor(db, key))).toMatchObject({ status: "completed", watchCount: 1 });
  });
});
