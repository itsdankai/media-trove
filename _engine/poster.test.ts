import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { media, openDb } from "./db.ts";

describe("rating posters (RPDB)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
  const app = () => createApp(openDb(":memory:"), []);

  it("without RPDB_API_KEY there's nothing to fetch", async () => {
    vi.stubEnv("RPDB_API_KEY", "");
    expect((await app().request("/api/poster/tmdb-movie-603")).status).toBe(404);
  });

  it("asks RPDB by TMDB id (series for shows) and passes the image through, cached a week", async () => {
    vi.stubEnv("RPDB_API_KEY", "t1-test");
    const fetchMock = vi.fn(async (_url: string) => new Response("jpg", { headers: { "content-type": "image/jpeg" } }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await app().request("/api/poster/tmdb-show-1399");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("max-age=604800");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "https://api.ratingposterdb.com/t1-test/tmdb/poster-default/series-1399.jpg",
    );
  });

  it("falls back to the IMDb id when RPDB doesn't know the TMDB id", async () => {
    vi.stubEnv("RPDB_API_KEY", "t1-test");
    const db = openDb(":memory:");
    db.insert(media)
      .values({
        key: "tmdb-movie-977942",
        kind: "movie",
        title: "The Uprising",
        genres: [],
        extra: { imdb: "tt36983905" },
        updatedAt: 0,
      })
      .run();
    const fetchMock = vi.fn(async (url: string) =>
      url.includes("/imdb/")
        ? new Response("jpg", { headers: { "content-type": "image/jpeg" } })
        : new Response("not found", { status: 404 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await createApp(db, []).request("/api/poster/tmdb-movie-977942");
    expect(res.status).toBe(200);
    expect(String(fetchMock.mock.calls[1][0])).toContain("/imdb/poster-default/tt36983905.jpg");
  });

  it("only TMDB movie and show keys are accepted", async () => {
    vi.stubEnv("RPDB_API_KEY", "t1-test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await app().request("/api/poster/audible-audiobook-B0123")).status).toBe(404);
    expect((await app().request("/api/poster/tmdb-movie-1..2")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
