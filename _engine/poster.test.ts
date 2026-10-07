import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.ts";
import { openDb } from "./db.ts";

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

  it("only TMDB movie and show keys are accepted", async () => {
    vi.stubEnv("RPDB_API_KEY", "t1-test");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect((await app().request("/api/poster/audible-audiobook-B0123")).status).toBe(404);
    expect((await app().request("/api/poster/tmdb-movie-1..2")).status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
