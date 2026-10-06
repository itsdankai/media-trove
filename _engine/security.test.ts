import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { passwordGate } from "./auth.ts";
import { projectRoot } from "./paths.ts";
import { ProcessHost, pluginEnv } from "./plugins/host.ts";

describe("security pass (2026-10-06)", () => {
  const app = (pw?: string) =>
    new Hono()
      .use("*", passwordGate(pw))
      .get("/api/health", (c) => c.text("ok"))
      .get("/api/library", (c) => c.text("secret"));
  const basic = (pw: string) => ({ authorization: `Basic ${Buffer.from(`anyone:${pw}`).toString("base64")}` });

  it("without MEDIATROVE_PASSWORD everything is open (your own machine)", async () => {
    expect((await app().request("/api/library")).status).toBe(200);
  });

  it("with it, every page needs the password; health checks don't", async () => {
    const a = app("correct horse");
    expect((await a.request("/api/library")).status).toBe(401);
    expect((await a.request("/api/library", { headers: basic("wrong") })).status).toBe(401);
    expect((await a.request("/api/library", { headers: basic("correct horse") })).status).toBe(200);
    expect((await a.request("/api/health")).status).toBe(200);
  });

  it("a plugin added by URL can't take a bundled plugin's id (and with it, that plugin's credentials)", async () => {
    const host = new ProcessHost(projectRoot, { catalogUrl: "http://127.0.0.1:9/none.json" });
    const manifest = (id: string) => ({ contract: 1, id, name: id, connect: { fields: [] } });
    vi.stubGlobal(
      "fetch",
      async (url: string) => new Response(JSON.stringify(manifest(url.includes("evil") ? "stremio" : "hello"))),
    );
    try {
      await expect(host.addCustom("https://evil.example/manifest.json")).rejects.toThrow(/already installed/);
      await expect(host.addCustom("https://fine.example/manifest.json")).resolves.toMatchObject({ id: "hello" });
    } finally {
      vi.unstubAllGlobals();
      host.stopAll();
    }
  });

  it("bundled plugins don't get MediaTrove's keys or other secrets", () => {
    const env = pluginEnv({
      PATH: "/usr/bin",
      TZ: "UTC",
      TMDB_API_KEY: "k",
      MEDIATROVE_SECRET_KEY: "s",
      MEDIATROVE_PASSWORD: "p",
      SIMKL_CLIENT_ID: "c",
      AWS_SECRET_ACCESS_KEY: "x",
    });
    expect(env).toEqual({ PATH: "/usr/bin", TZ: "UTC" });
  });
});
