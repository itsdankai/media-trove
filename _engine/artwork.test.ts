import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";
import { createLibrary } from "./library.ts";
import type { MediaInfo, MetadataProvider } from "./metadata/types.ts";

const merged = "audible-audiobook-B0CTWQ44B4+B0D5DKK1VS";
const single = "audible-audiobook-B074NBTRGL";
const info = (key: string): MediaInfo => ({
  key,
  kind: "audiobook",
  title: "Morning Star",
  year: 2024,
  poster: "https://m.media-amazon.com/part1.jpg",
  overview: null,
  genres: [],
  extra: {},
});
const provider: MetadataProvider = { kinds: ["audiobook"], search: async () => [], details: async (k) => info(k) };
const pixel = `data:image/png;base64,${Buffer.from("89504e470d0a1a0a", "hex").toString("base64")}`;

describe("source artwork", () => {
  it("replaces the catalog cover for merged editions only, and survives a metadata refresh", async () => {
    const db = openDb(":memory:");
    const artworkDir = mkdtempSync(join(tmpdir(), "mt-art-"));
    const lib = createLibrary(db, [provider], { artworkDir });
    await lib.ensureMedia(merged);
    await lib.ensureMedia(single);
    lib.saveArtwork(merged, "audiobookshelf", pixel);
    lib.saveArtwork(single, "audiobookshelf", pixel);

    const app = createApp(db, [provider], undefined, { artworkDir });
    const m = (await (await app.request(`/api/media/${merged}`)).json()) as { media: { poster: string } };
    const s = (await (await app.request(`/api/media/${single}`)).json()) as { media: { poster: string } };
    expect(m.media.poster).toMatch(/^\/api\/artwork\/[a-f0-9]{20}\.png$/); // still ours after details() refreshed it
    expect(s.media.poster).toBe("https://m.media-amazon.com/part1.jpg");

    const img = await app.request(m.media.poster);
    expect(img.status).toBe(200);
    expect(img.headers.get("content-type")).toBe("image/png");
    expect((await app.request("/api/artwork/..%2Fsecret.key")).status).toBe(404);
  });
});
