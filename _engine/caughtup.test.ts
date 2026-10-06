import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { appendEvents, eventsFor, project } from "./events.ts";
import { createLibrary } from "./library.ts";
import type { MediaInfo, MetadataProvider } from "./metadata/types.ts";

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

  it("in the app: Caught up only when an unseen episode is actually coming", async () => {
    const appDb = openDb(":memory:");
    const show = (key: string, extra: Record<string, unknown>): MediaInfo => ({
      key,
      kind: "show",
      title: key,
      year: 2026,
      poster: null,
      overview: null,
      genres: [],
      extra: { status: "Returning Series", airedEpisodes: 2, ...extra },
    });
    const shows = [
      show("tmdb-show-10", { totalEpisodes: 3, nextEpisode: { season: 1, number: 3, airDate: "2026-10-07" } }), // Last Seen
      show("tmdb-show-11", { totalEpisodes: 2, nextEpisode: null }), // Furious: season done, nothing announced
    ];
    const provider: MetadataProvider = {
      kinds: ["show"],
      search: async () => [],
      details: async (k) => shows.find((s) => s.key === k) as MediaInfo,
    };
    const lib = createLibrary(appDb, [provider]);
    for (const s of shows) lib.upsertMedia(s);
    for (const s of shows)
      appendEvents(
        appDb,
        [1, 2].map((episode) => ({
          mediaKey: s.key,
          kind: "watched" as const,
          season: 1,
          episode,
          source: "manual",
          occurredAt: `2026-10-0${episode}T20:00:00.000Z`,
        })),
      );
    const list = (await (await createApp(appDb, [provider]).request("/api/library?kind=show")).json()) as {
      media: { key: string };
      state: { status: string };
    }[];
    const status = Object.fromEntries(list.map((i) => [i.media.key, i.state.status]));
    expect(status).toEqual({ "tmdb-show-10": "caught_up", "tmdb-show-11": "completed" });
  });

  it("a new episode airs (aired count goes up): back to Watching", () => {
    expect(project("show", list, 3, 0.9, true).status).toBe("watching");
  });
});
