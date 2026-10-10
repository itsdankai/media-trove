import { describe, expect, it } from "vitest";
import { groupProgress } from "../app/src/lib/activity.ts";
import type { EventRow } from "../app/src/lib/api.ts";

// The Activity and History lines the app draws (app/src/lib/activity.ts), checked here with the engine's tests.
let n = 0;
const ev = (e: Partial<EventRow>): EventRow => ({
  id: String(n++),
  mediaKey: "tmdb-show-288673",
  kind: "watched",
  season: 1,
  episode: 4,
  progress: null,
  source: "nuvio",
  occurredAt: "2026-10-08T21:36:00Z",
  ...e,
});

describe("one viewing, one line (Astra critique 2026-10-09)", () => {
  it("folds two apps' reports of the same watch, and the 100% that came with it, into one line naming both", () => {
    const rows = [
      ev({ source: "stremio", sourceName: "Stremio", occurredAt: "2026-10-08T21:36:05Z" }),
      ev({ source: "nuvio", sourceName: "Nuvio", occurredAt: "2026-10-08T21:36:00Z" }),
      ev({ kind: "progress", progress: 1, source: "nuvio", sourceName: "Nuvio", occurredAt: "2026-10-08T21:35:50Z" }),
    ];
    const groups = groupProgress(rows, (e) => e);
    expect(groups).toHaveLength(1);
    expect(groups[0].last.source).toBe("stremio");
    expect(groups[0].also).toEqual(["Nuvio"]);
    expect(groups[0].rows).toHaveLength(3);
  });

  it("keeps different episodes, a rewatch days later, unmarks and half-way positions apart", () => {
    const rows = [
      ev({ episode: 5, occurredAt: "2026-10-08T22:30:00Z" }),
      ev({ occurredAt: "2026-10-08T21:36:00Z" }),
      ev({ kind: "unwatched", occurredAt: "2026-10-08T21:30:00Z" }),
      ev({ kind: "progress", progress: 0.4, occurredAt: "2026-10-08T21:00:00Z" }),
      ev({ source: "stremio", occurredAt: "2026-10-01T21:36:00Z" }), // a week earlier: its own viewing
    ];
    expect(groupProgress(rows, (e) => e)).toHaveLength(5);
  });

  it("doesn't fold a manual mark's own name in, and names each extra app once", () => {
    const rows = [
      ev({ source: "manual", occurredAt: "2026-10-08T21:40:00Z" }),
      ev({ source: "nuvio", sourceName: "Nuvio" }),
      ev({ source: "stremio", sourceName: "Stremio", occurredAt: "2026-10-08T21:36:02Z" }),
    ];
    const [g] = groupProgress(rows, (e) => e);
    expect(g.also).toEqual(["Nuvio", "Stremio"]);
  });
});
