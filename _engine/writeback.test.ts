import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Manifest, PushItem } from "../plugins/_sdk/index.ts";
import { encrypt } from "./crypto.ts";
import { connections, openDb } from "./db.ts";
import { appendEvents, eventsFor, type NewEvent, project } from "./events.ts";
import { createLibrary } from "./library.ts";
import type { MediaInfo, MetadataProvider } from "./metadata/types.ts";
import type { PluginHost } from "./plugins/host.ts";
import { createWriteback, type SyncMode } from "./writeback.ts";

const movie = "tmdb-movie-603";
const show = "tmdb-show-95396";
const info: Record<string, MediaInfo> = {
  [movie]: {
    key: movie,
    kind: "movie",
    title: "The Matrix",
    year: 1999,
    poster: null,
    overview: null,
    genres: [],
    extra: { imdb: "tt0133093", tvdb: null },
  },
  [show]: {
    key: show,
    kind: "show",
    title: "Severance",
    year: 2022,
    poster: null,
    overview: null,
    genres: [],
    extra: { imdb: "tt11280740", tvdb: 371980 },
  },
};
const provider: MetadataProvider = { kinds: ["movie", "show"], search: async () => [], details: async (k) => info[k] };
const day = (d: number, h = 20) => new Date(Date.UTC(2026, 9, d, h)).toISOString();
const KEY = Buffer.alloc(32, 7);

/** A fake app that remembers what it was told; notFound for titles it doesn't have. */
function setup(mode: SyncMode, opts: { since?: number; missing?: string[] } = {}) {
  const db = openDb(":memory:");
  const lib = createLibrary(db, [provider]);
  for (const m of Object.values(info)) lib.upsertMedia(m);
  const received: PushItem[] = [];
  const manifest = {
    contract: 1,
    id: "player",
    name: "Player",
    version: "1",
    description: "",
    kinds: ["movie", "show"],
    connect: { fields: [] },
    sync: { intervalSeconds: 60 },
    capabilities: { write: true },
  } satisfies Manifest;
  const host = {
    manifest: async () => manifest,
    call: async (_id: string, _path: string, body: { items: PushItem[] }) => {
      received.push(...body.items);
      return {
        results: body.items.map((i) =>
          opts.missing?.includes(i.media.title ?? "") ? { ok: false, notFound: true } : { ok: true },
        ),
      };
    },
  } as unknown as PluginHost;
  db.insert(connections)
    .values({
      id: "c1",
      pluginId: "player",
      accountName: "me",
      credentials: encrypt(KEY, { token: "t" }),
      createdAt: Date.parse(day(1)),
      syncMode: mode,
      syncModeSince: opts.since ?? Date.parse(day(1)),
    })
    .run();
  const wb = createWriteback(db, lib, host, KEY);
  const add = (...list: NewEvent[]) => appendEvents(db, list, Date.now(), { followUnmarks: true });
  const conn = () =>
    db.select().from(connections).where(eq(connections.id, "c1")).get() as typeof connections.$inferSelect;
  return { db, wb, add, received, conn };
}

const ev = (over: Partial<NewEvent>): NewEvent => ({
  mediaKey: movie,
  kind: "watched",
  source: "manual",
  occurredAt: day(2),
  ...over,
});

describe("keeping an app in sync (phase 6)", () => {
  it("Add only: a mark made in MediaTrove is sent to the app, with its ids", async () => {
    const t = setup("add");
    t.add(ev({}));
    await t.wb.push("c1");
    expect(t.received).toEqual([
      {
        media: { kind: "movie", tmdb: 603, imdb: "tt0133093", tvdb: undefined, title: "The Matrix", year: 1999 },
        action: "watched",
        occurredAt: day(2),
      },
    ]);
  });

  it("marks from another app are sent too (Stremio watch -> this app)", async () => {
    const t = setup("add");
    t.add(ev({ source: "stremio", mediaKey: show, season: 1, episode: 3 }));
    await t.wb.push("c1");
    expect(t.received[0]).toMatchObject({ action: "watched", season: 1, episode: 3, media: { tmdb: 95396 } });
  });

  it("nothing is sent when the app already has it, or only the app ever touched it", async () => {
    const t = setup("add");
    t.add(ev({ occurredAt: day(2) }), ev({ source: "player", occurredAt: day(3) }));
    t.add(ev({ mediaKey: show, season: 1, episode: 1, source: "player" }));
    await t.wb.push("c1");
    expect(t.received).toEqual([]);
  });

  it("latest action wins: an unmark made in the app later is never undone", async () => {
    const t = setup("add");
    t.add(ev({ occurredAt: day(2) }), ev({ kind: "unwatched", source: "player", occurredAt: day(3) }));
    await t.wb.push("c1");
    expect(t.received).toEqual([]);
  });

  it("Add only never unmarks; Full sends unmarks made after it was turned on", async () => {
    const add = setup("add");
    add.add(ev({ source: "player", occurredAt: day(2) }), ev({ kind: "unwatched", occurredAt: day(3) }));
    await add.wb.push("c1");
    expect(add.received).toEqual([]);

    const full = setup("full");
    full.add(ev({ source: "player", occurredAt: day(2) }), ev({ kind: "unwatched", occurredAt: day(3) }));
    await full.wb.push("c1");
    expect(full.received).toMatchObject([{ action: "unwatched" }]);
  });

  it("switching Add only to Full doesn't send unmarks made while it was Add only", async () => {
    const t = setup("add");
    t.add(ev({ source: "player", occurredAt: day(2) }), ev({ kind: "unwatched", occurredAt: day(3) }));
    t.wb.setMode("c1", "full");
    const since = t.conn().syncModeSince as number;
    expect(since).toBeGreaterThan(Date.parse(day(3)));
    await t.wb.push("c1");
    expect(t.received).toEqual([]);
  });

  it("Full leaves alone unmarks made before it was turned on", async () => {
    const t = setup("full", { since: Date.parse(day(5)) });
    t.add(ev({ source: "player", occurredAt: day(2) }), ev({ kind: "unwatched", occurredAt: day(3) }));
    await t.wb.push("c1");
    expect(t.received).toEqual([]);
  });

  it("each change is sent once, and titles the app doesn't have aren't asked about again", async () => {
    const t = setup("add", { missing: ["Severance"] });
    t.add(ev({}), ev({ mediaKey: show, season: 1, episode: 1 }));
    expect((await t.wb.push("c1"))?.notFound).toBe(1);
    await t.wb.push("c1");
    expect(t.received).toHaveLength(2);
    t.db.update(connections).set({ lastPushAt: null }).where(eq(connections.id, "c1")).run();
    // A full re-check (lastPushAt cleared) still sends nothing new.
    await t.wb.push("c1");
    expect(t.received).toHaveLength(2);
  });

  it("no echo: the app reporting the pushed mark back doesn't add a second watch", async () => {
    const t = setup("add");
    t.add(ev({ occurredAt: day(2) }));
    await t.wb.push("c1");
    t.add(ev({ source: "player", occurredAt: day(2, 21) })); // the app's own date, an hour later
    expect(project("movie", eventsFor(t.db, movie)).watchCount).toBe(1);
    await t.wb.push("c1");
    expect(t.received).toHaveLength(1);
  });

  it('"only new marks from now on" never sends the past, but sends what comes after', async () => {
    const t = setup("off");
    t.add(ev({ occurredAt: day(2) }), ev({ mediaKey: show, season: 1, episode: 1, occurredAt: day(2) }));
    expect(await t.wb.settleBacklog("c1", "add")).toBe(2);
    t.wb.setMode("c1", "add");
    await t.wb.push("c1");
    expect(t.received).toEqual([]);
    t.add(ev({ mediaKey: show, season: 1, episode: 2, occurredAt: day(3) }));
    await t.wb.push("c1");
    expect(t.received).toMatchObject([{ action: "watched", season: 1, episode: 2 }]);
  });

  it("preview counts what turning a mode on would send, and sends nothing", async () => {
    const t = setup("off");
    t.add(ev({}), ev({ mediaKey: show, season: 1, episode: 1 }), ev({ mediaKey: show, season: 1, episode: 2 }));
    expect(await t.wb.preview("c1", "add")).toMatchObject({ watched: 3, unwatched: 0, titles: 2 });
    expect(await t.wb.push("c1")).toBeNull(); // off: nothing happens
    expect(t.received).toEqual([]);
  });
});
