import { describe, expect, it } from "vitest";
import { definePlugin, type PluginEvent } from "../plugins/_sdk/index.ts";
import { createApp } from "./app.ts";
import { decrypt, encrypt } from "./crypto.ts";
import { connections, openDb } from "./db.ts";
import { appendEvents, eventsFor, type NewEvent, project } from "./events.ts";
import { createLibrary } from "./library.ts";
import type { MediaInfo, MetadataProvider } from "./metadata/types.ts";
import type { CatalogEntry, PluginHost } from "./plugins/host.ts";
import { createSync } from "./sync.ts";

const show = "tmdb-show-95396";
const movie = "tmdb-movie-603";
const at = (min: number) => new Date(Date.UTC(2026, 9, 5, 20, min)).toISOString();
const ev = (e: Partial<NewEvent>): NewEvent => ({
  mediaKey: movie,
  kind: "progress",
  source: "stremio",
  occurredAt: at(0),
  ...e,
});

function fold(kind: "movie" | "show", list: NewEvent[], threshold = 0.9, aired?: number) {
  const db = openDb(":memory:");
  appendEvents(db, list);
  return project(kind, eventsFor(db, list[0].mediaKey), aired, threshold);
}

describe("sync rules", () => {
  it("rule 1: 3 episodes from one source and 5 from another give 5", () => {
    const a = [1, 2, 3].map((n) =>
      ev({ mediaKey: show, kind: "watched", season: 1, episode: n, source: "stremio", occurredAt: at(n) }),
    );
    const b = [1, 2, 3, 4, 5].map((n) =>
      ev({ mediaKey: show, kind: "watched", season: 1, episode: n, source: "nuvio", occurredAt: at(10 + n) }),
    );
    expect(fold("show", [...a, ...b]).watchedEpisodes).toHaveLength(5);
  });

  it("rule 2: 80% then 55% (later, other source) gives 55%", () => {
    const s = fold("movie", [
      ev({ progress: 0.8, occurredAt: at(1) }),
      ev({ progress: 0.55, source: "nuvio", occurredAt: at(2) }),
    ]);
    expect(s).toMatchObject({ status: "watching", progress: 0.55, watchCount: 0 });
  });

  it("rule 2 uses when it happened, not arrival order", () => {
    // The 55% report is older but arrives last; 80% still wins.
    const s = fold("movie", [
      ev({ progress: 0.8, occurredAt: at(5) }),
      ev({ progress: 0.55, source: "nuvio", occurredAt: at(1) }),
    ]);
    expect(s.progress).toBe(0.8);
  });

  it("rule 3: threshold 90%: 89% is in progress, 90% is watched and stays watched", () => {
    expect(fold("movie", [ev({ progress: 0.89 })])).toMatchObject({ status: "watching", watchCount: 0 });
    expect(fold("movie", [ev({ progress: 0.9 })])).toMatchObject({ status: "completed", watchCount: 1 });
    const later = fold("movie", [ev({ progress: 0.95, occurredAt: at(1) }), ev({ progress: 0.2, occurredAt: at(2) })]);
    expect(later).toMatchObject({ watchCount: 1, progress: 0.2, status: "watching" }); // a new viewing, not undone
    const twice = fold("movie", [
      ev({ progress: 0.95, occurredAt: at(1) }),
      ev({ progress: 0.2, occurredAt: at(2) }),
      ev({ progress: 0.97, occurredAt: at(3) }),
    ]);
    expect(twice.watchCount).toBe(2);
  });

  it("rule 3: changing the threshold to 80% re-folds 85% as watched", () => {
    const list = [ev({ progress: 0.85 })];
    expect(fold("movie", list, 0.9).watchCount).toBe(0);
    expect(fold("movie", list, 0.8).watchCount).toBe(1);
  });

  it("rule 3 applies per episode", () => {
    const s = fold("show", [
      ev({ mediaKey: show, season: 1, episode: 1, progress: 0.95, occurredAt: at(1) }),
      ev({ mediaKey: show, season: 1, episode: 2, progress: 0.4, occurredAt: at(2) }),
    ]);
    expect(s.watchedEpisodes).toEqual(["s1e1"]);
    expect(s.current).toEqual({ season: 1, episode: 2, progress: 0.4 });
  });

  it("rule 4: a plugin's unwatched is refused; the user's is allowed", () => {
    const db = openDb(":memory:");
    appendEvents(db, [ev({ kind: "watched" })]);
    expect(appendEvents(db, [ev({ kind: "unwatched", occurredAt: at(1) })])).toEqual({ inserted: 0, refused: 1 });
    expect(appendEvents(db, [ev({ kind: "unwatched", source: "manual", occurredAt: at(1) })])).toEqual({
      inserted: 1,
      refused: 0,
    });
  });
});

describe("crypto", () => {
  it("round-trips and doesn't leak the plaintext", () => {
    const key = Buffer.alloc(32, 7);
    const sealed = encrypt(key, { token: "super-secret-token" });
    expect(sealed).not.toContain("super-secret");
    expect(decrypt(key, sealed)).toEqual({ token: "super-secret-token" });
    expect(() => decrypt(Buffer.alloc(32, 8), sealed)).toThrow();
  });
});

// --- full sync through a fake plugin, in process -----------------------------------------------

const info: Record<string, MediaInfo> = {
  [movie]: {
    key: movie,
    kind: "movie",
    title: "The Matrix",
    year: 1999,
    poster: null,
    overview: null,
    genres: [],
    extra: {},
  },
  [show]: {
    key: show,
    kind: "show",
    title: "Severance",
    year: 2022,
    poster: null,
    overview: null,
    genres: [],
    extra: { airedEpisodes: 19 },
  },
};
const provider: MetadataProvider = {
  kinds: ["movie", "show"],
  search: async () => [],
  details: async (k) => info[k],
  resolve: async (r) => (r.imdb === "tt0133093" ? movie : r.imdb === "tt11280740" ? show : null),
};

function fakeHost(events: PluginEvent[]): PluginHost {
  const plugin = definePlugin<{ token: string }>({
    manifest: {
      contract: 1,
      id: "fake",
      name: "Fake Player",
      version: "1",
      description: "",
      kinds: ["movie"],
      connect: { fields: [] },
      sync: { intervalSeconds: 60 },
    },
    connect: async (f) => {
      if (f.password !== "right") throw new (await import("../plugins/_sdk/index.ts")).UserError("Wrong password.");
      return { account: { name: "tester" }, credentials: { token: "tok-123" } };
    },
    sync: async (creds, cursor) => ({
      events: (cursor as number) ? [] : events,
      cursor: 1,
      credentials: { token: `${creds.token}-refreshed` },
    }),
  });
  const catalog: CatalogEntry[] = [
    { id: "fake", name: "Fake Player", description: "", kinds: ["movie"], tags: [], author: "test", bundled: true },
  ];
  return {
    catalog: async () => catalog,
    manifest: async () => (await (await plugin.request("/manifest.json")).json()) as never,
    statuses: () => ({ fake: { state: "running", since: 0 } }),
    async call(_id, path, body) {
      const r = await plugin.request(path, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
      const data = (await r.json()) as { error?: string; user?: boolean };
      if (!r.ok) throw new (await import("./plugins/host.ts")).PluginUserError(data.error ?? "");
      return data as never;
    },
  };
}

describe("sync engine", () => {
  const pluginEvents: PluginEvent[] = [
    { media: { kind: "movie", imdb: "tt0133093" }, kind: "progress", progress: 0.95, occurredAt: at(1) },
    { media: { kind: "show", imdb: "tt11280740" }, kind: "watched", season: 1, episode: 1, occurredAt: at(2) },
    { media: { kind: "movie", imdb: "tt0000000" }, kind: "watched", occurredAt: at(3) },
  ];

  function setup() {
    const db = openDb(":memory:");
    const key = Buffer.alloc(32, 1);
    const host = fakeHost(pluginEvents);
    const sync = createSync(db, createLibrary(db, [provider]), host, key);
    const app = createApp(db, [provider], { host, sync });
    return { db, key, sync, app };
  }

  it("connects, stores only encrypted credentials, syncs, and is idempotent", async () => {
    const { db, key, sync } = setup();
    await expect(sync.connect("fake", { password: "wrong" })).rejects.toThrow("Wrong password.");
    const conn = await sync.connect("fake", { password: "right" });
    const stored = db.select().from(connections).get();
    expect(stored?.credentials).not.toContain("tok-123");
    expect(stored?.credentials).not.toContain("right");
    expect(decrypt(key, stored?.credentials ?? "")).toEqual({ token: "tok-123" });

    const first = await sync.syncNow(conn.id);
    expect(first).toMatchObject({ received: 3, added: 2, unmatched: 1 });
    expect(decrypt(key, db.select().from(connections).get()?.credentials ?? "")).toEqual({
      token: "tok-123-refreshed",
    });
    expect((await sync.syncNow(conn.id)).added).toBe(0); // cursor advanced
  });

  it("history and item activity show the source name", async () => {
    const { sync, app } = setup();
    const conn = await sync.connect("fake", { password: "right" });
    await sync.syncNow(conn.id);
    const history = (await (await app.request("/api/history")).json()) as {
      sourceName: string;
      event: { source: string };
    }[];
    expect(history.every((h) => h.event.source === "fake" && h.sourceName === "Fake Player")).toBe(true);
    const detail = (await (await app.request(`/api/media/${movie}`)).json()) as {
      events: { sourceName: string }[];
      state: { status: string };
    };
    expect(detail.events[0].sourceName).toBe("Fake Player");
    expect(detail.state.status).toBe("completed"); // 95% ≥ default 90%
  });

  it("marketplace search filters the catalog and the settings threshold re-folds state", async () => {
    const { sync, app } = setup();
    expect(await (await app.request("/api/marketplace?q=fake")).json()).toHaveLength(1);
    expect(await (await app.request("/api/marketplace?q=nothing-like-this")).json()).toHaveLength(0);
    const conn = await sync.connect("fake", { password: "right" });
    await sync.syncNow(conn.id);
    await app.request("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ watchedThreshold: 0.99 }),
      headers: { "content-type": "application/json" },
    });
    const detail = (await (await app.request(`/api/media/${movie}`)).json()) as { state: { status: string } };
    expect(detail.state.status).toBe("watching");
  });
});
