import { afterEach, describe, expect, it, vi } from "vitest";
import plugin, { assertRpcAllowed } from "./plugin.ts";

const creds = {
  server: "https://nuvio.example",
  key: "pub",
  accessToken: "a",
  refreshToken: "r",
  expiresAt: Date.now() + 3_600_000,
  profile: 1,
};

describe("Nuvio writes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("only the two watched-item writes are allowed, and only when pushing", () => {
    expect(() => assertRpcAllowed("sync_pull_watched_items")).not.toThrow();
    expect(() => assertRpcAllowed("sync_push_watched_items")).toThrow(/refused/);
    expect(() => assertRpcAllowed("sync_push_watched_items", true)).not.toThrow();
    expect(() => assertRpcAllowed("sync_delete_watched_items", true)).not.toThrow();
    expect(() => assertRpcAllowed("sync_push_library", true)).toThrow(/refused/);
    expect(() => assertRpcAllowed("sync_push_addons", true)).toThrow(/refused/);
  });

  it("marks and unmarks with the same rows the Nuvio apps write", async () => {
    const calls: { name: string; body: Record<string, unknown> }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ name: url.split("/rpc/")[1], body: JSON.parse(String(init.body)) });
      return new Response("");
    });
    const res = await plugin.request("/push", {
      method: "POST",
      body: JSON.stringify({
        credentials: creds,
        items: [
          {
            media: { kind: "show", imdb: "tt0118276", title: "Buffy" },
            action: "watched",
            season: 1,
            episode: 2,
            occurredAt: "2026-10-06T08:00:00.000Z",
          },
          { media: { kind: "movie", imdb: "tt0133093" }, action: "unwatched", occurredAt: "2026-10-06T08:00:00.000Z" },
          { media: { kind: "movie", title: "No imdb" }, action: "watched", occurredAt: "2026-10-06T08:00:00.000Z" },
        ],
      }),
    });
    expect((await res.json()).results).toEqual([{ ok: true }, { ok: true }, { ok: false, notFound: true }]);
    expect(calls).toEqual([
      {
        name: "sync_push_watched_items",
        body: {
          p_profile_id: 1,
          p_origin_client_id: "mediatrove",
          p_items: [
            {
              content_id: "tt0118276",
              content_type: "series",
              season: 1,
              episode: 2,
              title: "Buffy",
              watched_at: Date.parse("2026-10-06T08:00:00.000Z"),
            },
          ],
        },
      },
      {
        name: "sync_delete_watched_items",
        body: {
          p_profile_id: 1,
          p_origin_client_id: "mediatrove",
          p_keys: [{ content_id: "tt0133093", season: null, episode: null }],
        },
      },
    ]);
  });
});
