import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportAll, restore, weeklyBackup } from "./backup.ts";
import { emailBackup, emailConfigured } from "./backup-email.ts";
import { connections, openDb, watchlist } from "./db.ts";
import { appendEvents, eventsFor, project } from "./events.ts";
import { createLibrary } from "./library.ts";
import type { MediaInfo, MetadataProvider } from "./metadata/types.ts";

const movie: MediaInfo = {
  key: "tmdb-movie-603",
  kind: "movie",
  title: "The Matrix",
  year: 1999,
  poster: null,
  overview: null,
  genres: [],
  extra: {},
};
const none: MetadataProvider = { kinds: ["movie", "show"], search: async () => [], details: async () => movie };

function library() {
  const db = openDb(":memory:");
  createLibrary(db, [none]).upsertMedia(movie);
  appendEvents(db, [
    { mediaKey: movie.key, kind: "watched", source: "manual", occurredAt: "2024-01-01T20:00:00.000Z" },
    { mediaKey: movie.key, kind: "watched", source: "stremio", occurredAt: "2025-06-01T20:00:00.000Z" },
  ]);
  db.insert(connections)
    .values({ id: "c", pluginId: "stremio", accountName: "me", credentials: "secret", createdAt: 1 })
    .run();
  return db;
}

describe("emailed backups (Resend)", () => {
  const env = {
    RESEND_API_KEY: "re_test",
    MEDIATROVE_BACKUP_EMAIL_TO: "me@example.com",
    MEDIATROVE_BACKUP_EMAIL_FROM: "MediaTrove <backups@example.com>",
  };

  it("does nothing unless all three settings are there", async () => {
    expect(emailConfigured({ RESEND_API_KEY: "re_test" })).toBe(false);
    expect(await emailBackup("mediatrove-2026-10-06.json", "{}", { titles: 0, events: 0 }, {})).toBe(false);
  });

  it("sends the file as an attachment, to the configured address", async () => {
    let sent: { headers: Record<string, string>; body: Record<string, unknown> } | null = null;
    const fake = (async (_url: string, init: RequestInit) => {
      sent = { headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) };
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    expect(await emailBackup("mediatrove-2026-10-06.json", '{"a":1}', { titles: 3, events: 9 }, env, fake)).toBe(true);
    expect(sent).toMatchObject({
      headers: { Authorization: "Bearer re_test" },
      body: {
        to: ["me@example.com"],
        subject: "Your MediaTrove backup (2026-10-06)",
        attachments: [{ filename: "mediatrove-2026-10-06.json", content: Buffer.from('{"a":1}').toString("base64") }],
      },
    });
  });
});

describe("backups", () => {
  it("hold every title and event, never connections or credentials", () => {
    const b = exportAll(library());
    expect(b.media).toHaveLength(1);
    expect(b.events).toHaveLength(2);
    expect(JSON.stringify(b)).not.toContain("secret");
  });

  it("restore into an empty library brings everything back; restoring again adds nothing", () => {
    const backup = JSON.parse(JSON.stringify(exportAll(library())));
    const fresh = openDb(":memory:");
    expect(restore(fresh, backup)).toMatchObject({ titles: 1, events: 2, added: 2 });
    expect(project("movie", eventsFor(fresh, movie.key)).watchCount).toBe(2);
    expect(restore(fresh, backup).added).toBe(0);
  });

  it("refuses files that aren't backups", () => {
    expect(() => restore(openDb(":memory:"), { hello: 1 })).toThrow(/isn't a MediaTrove backup/);
  });

  it("weekly: writes when the newest is a week old, keeps the last 8", () => {
    const db = library();
    const dir = mkdtempSync(join(tmpdir(), "mt-backup-"));
    const day = 24 * 60 * 60 * 1000;
    const start = Date.parse("2026-01-01T12:00:00Z");
    expect(weeklyBackup(db, dir, start)).toBe("mediatrove-2026-01-01.json");
    for (let w = 1; w <= 10; w++) {
      // The file's own mtime is "now" in this test, so pretend a week passed by using a later date each time.
      const written = weeklyBackup(db, dir, Date.now() + w * 8 * day);
      expect(written).not.toBeNull();
    }
    expect(readdirSync(join(dir, "backups"))).toHaveLength(8);
  });
});

describe("backups keep the watchlist (2026-10-07)", () => {
  it("exports it and restores it; older backups without one still restore", () => {
    const db = openDb(":memory:");
    db.insert(watchlist).values({ mediaKey: "tmdb-movie-603", addedAt: 1 }).run();
    const backup = JSON.parse(JSON.stringify(exportAll(db)));
    expect(backup.watchlist).toEqual([{ mediaKey: "tmdb-movie-603", addedAt: 1 }]);
    const fresh = openDb(":memory:");
    restore(fresh, backup);
    expect(fresh.select().from(watchlist).all()).toHaveLength(1);
    const { watchlist: _, ...old } = backup;
    expect(() => restore(openDb(":memory:"), old)).not.toThrow();
  });
});
