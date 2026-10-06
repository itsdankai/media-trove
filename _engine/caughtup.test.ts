import { describe, expect, it } from "vitest";
import { openDb } from "./db.ts";
import { appendEvents, eventsFor, project } from "./events.ts";

describe("Caught up", () => {
  const db = openDb(":memory:");
  const key = "tmdb-show-1";
  appendEvents(
    db,
    [1, 2].map((episode) => ({
      mediaKey: key,
      kind: "watched" as const,
      season: 1,
      episode,
      source: "manual",
      occurredAt: `2026-10-0${episode}T20:00:00.000Z`,
    })),
  );
  const list = eventsFor(db, key);

  it("every aired episode seen: Caught up while the show airs, Completed once it has ended", () => {
    expect(project("show", list, 2, 0.9, true).status).toBe("caught_up");
    expect(project("show", list, 2, 0.9, false).status).toBe("completed");
  });

  it("a new episode airs (aired count goes up): back to Watching", () => {
    expect(project("show", list, 3, 0.9, true).status).toBe("watching");
  });
});
