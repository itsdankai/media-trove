// The MediaTrove plugin contract, v1. A plugin is a small HTTP service with three routes:
//
//   GET  /manifest.json   who it is and which fields its connect form needs
//   POST /connect         { fields }               -> { account, credentials }
//   POST /sync            { credentials, cursor }  -> { events, cursor, credentials? }
//
// Plugins are stateless: MediaTrove stores the credentials (encrypted) and the cursor, and sends
// them back on every sync. Credentials are what the plugin chooses to keep (tokens), never the
// raw password the user typed. Plugins only report what happened; MediaTrove decides what it means.
// Full docs: docs/plugins.md

import { serve } from "@hono/node-server";
import { Hono } from "hono";

export const CONTRACT_VERSION = 1;

export type Field = {
  key: string;
  label: string;
  type: "text" | "url" | "password" | "number" | "email";
  required?: boolean;
  placeholder?: string;
  default?: string;
  help?: string;
};

export type Manifest = {
  contract: number;
  id: string; // lowercase, a-z0-9-
  name: string;
  version: string;
  description: string;
  kinds: ("movie" | "show" | "audiobook")[];
  homepage?: string;
  connect: { fields: Field[]; note?: string };
  sync: { intervalSeconds: number };
};

/** How a plugin names a title. Give every id you have; MediaTrove matches on the best one. */
export type MediaRef = {
  kind: "movie" | "show" | "audiobook";
  imdb?: string; // tt0133093
  tmdb?: number;
  tvdb?: number;
  asin?: string; // Audible
  isbn?: string;
  title?: string;
  year?: number;
  author?: string;
};

export type PluginEvent = {
  media: MediaRef;
  kind: "watched" | "progress" | "finished";
  season?: number;
  episode?: number;
  progress?: number; // 0..1
  occurredAt: string; // ISO time it happened in the source, not when it was synced
};

export type ConnectResult = { account: { name: string }; credentials: unknown };
export type SyncResult = { events: PluginEvent[]; cursor: unknown; credentials?: unknown };

/** Thrown for problems the user can fix (wrong password, bad URL). Shown to them as-is. */
export class UserError extends Error {}

export function definePlugin<C>(p: {
  manifest: Manifest;
  connect(fields: Record<string, string>): Promise<{ account: { name: string }; credentials: C }>;
  sync(credentials: C, cursor: unknown): Promise<{ events: PluginEvent[]; cursor: unknown; credentials?: C }>;
}) {
  return new Hono()
    .onError((err, c) => {
      const user = err instanceof UserError;
      if (!user) console.error(`[${p.manifest.id}]`, err);
      return c.json({ error: err.message, user }, user ? 400 : 500);
    })
    .get("/manifest.json", (c) => c.json(p.manifest))
    .post("/connect", async (c) => {
      const { fields } = await c.req.json<{ fields: Record<string, string> }>();
      return c.json(await p.connect(fields ?? {}));
    })
    .post("/sync", async (c) => {
      const { credentials, cursor } = await c.req.json<{ credentials: C; cursor: unknown }>();
      return c.json(await p.sync(credentials, cursor ?? null));
    });
}

/** Starts a plugin on PORT (set by MediaTrove when it launches bundled plugins). */
export function run(app: Hono) {
  const port = Number(process.env.PORT ?? 0);
  const server = serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
    console.log(`plugin listening on ${info.port}`);
  });
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => server.close(() => process.exit(0)));
}

/** fetch with a timeout and a readable error. */
export async function getJson<T = unknown>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  const text = await res.text();
  if (!res.ok)
    throw Object.assign(new Error(`${init.method ?? "GET"} ${new URL(url).pathname} → ${res.status}`), {
      status: res.status,
      body: text,
    });
  return (text ? JSON.parse(text) : null) as T;
}

export const msToIso = (ms: number) => new Date(ms).toISOString();
