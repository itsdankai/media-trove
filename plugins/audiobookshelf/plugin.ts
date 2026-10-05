// Audiobookshelf: reads the user's listening progress. Read-only by construction: absRequest()
// refuses anything outside READ_ONLY, so even an admin login can't change the server through us.
import { definePlugin, getJson, type Manifest, msToIso, type PluginEvent, UserError } from "../_sdk/index.ts";

export const manifest: Manifest = {
  contract: 1,
  id: "audiobookshelf",
  name: "Audiobookshelf",
  version: "0.1.0",
  description: "Track listening progress from your Audiobookshelf server.",
  kinds: ["audiobook"],
  homepage: "https://www.audiobookshelf.org",
  connect: {
    fields: [
      { key: "server", label: "Server address", type: "url", required: true, placeholder: "https://abs.example.com" },
      { key: "username", label: "Username", type: "text" },
      { key: "password", label: "Password", type: "password", help: "Used once to sign in. Not stored." },
      {
        key: "apiKey",
        label: "Or an API key",
        type: "password",
        help: "Instead of username and password: an ABS API key (Settings → Users → API Keys) made for a non-admin user.",
      },
    ],
    note: "A regular (non-admin) account is enough. MediaTrove only reads your progress.",
  },
  sync: { intervalSeconds: 300 },
};

export type AbsCredentials = { server: string; accessToken: string; refreshToken?: string; legacy?: boolean };

// The only requests this plugin may make. Everything else throws before any network call.
const READ_ONLY: [string, RegExp][] = [
  ["POST", /^\/login$/],
  ["POST", /^\/auth\/refresh$/],
  ["GET", /^\/api\/me$/],
  ["GET", /^\/api\/items\/[\w-]+$/],
];

export function assertReadOnly(method: string, path: string) {
  if (!READ_ONLY.some(([m, re]) => m === method && re.test(path))) {
    throw new Error(`Audiobookshelf plugin is read-only: refused ${method} ${path}`);
  }
}

export async function absRequest<T>(server: string, method: string, path: string, init: RequestInit = {}): Promise<T> {
  assertReadOnly(method, path);
  return getJson<T>(`${server}${path}`, { ...init, method });
}

const normalize = (server: string) => {
  const s = server.trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(s)) throw new UserError("Server address must start with http:// or https://");
  return s;
};

type LoginUser = { username: string; token?: string; accessToken?: string; refreshToken?: string };

type MeProgress = {
  libraryItemId: string;
  episodeId?: string | null;
  progress: number;
  currentTime?: number;
  duration?: number;
  isFinished: boolean;
  lastUpdate: number;
  finishedAt?: number | null;
};

/**
 * Position ÷ length when ABS has both. Its stored `progress` can lag behind the position
 * (seen on 2.37.1: currentTime moved, progress didn't), so the position is the source of truth.
 */
export function bookProgress(p: Pick<MeProgress, "progress" | "currentTime" | "duration" | "isFinished">) {
  if (p.isFinished) return 1;
  const raw = p.duration && p.duration > 0 && p.currentTime != null ? p.currentTime / p.duration : p.progress;
  return Math.round(Math.min(1, Math.max(0, raw)) * 1000) / 1000;
}

type Item = {
  mediaType: string;
  media: {
    metadata: {
      title?: string;
      authorName?: string;
      authors?: { name: string }[];
      asin?: string;
      isbn?: string;
      publishedYear?: string;
    };
  };
};

export type Cursor = {
  since: number;
  items: Record<string, { title?: string; author?: string; asin?: string; isbn?: string; year?: number } | null>;
  last: Record<string, number>; // progress last reported per item
};

export default definePlugin<AbsCredentials>({
  manifest,

  async connect(fields) {
    const server = normalize(fields.server ?? "");
    if (fields.apiKey?.trim()) {
      const accessToken = fields.apiKey.trim();
      let me: { username: string };
      try {
        me = await absRequest(server, "GET", "/api/me", { headers: { Authorization: `Bearer ${accessToken}` } });
      } catch (e) {
        if ((e as { status?: number }).status === 401) throw new UserError("Audiobookshelf rejected that API key.");
        throw new UserError(`Couldn't reach Audiobookshelf at ${server}.`);
      }
      return { account: { name: `${me.username} @ ${new URL(server).host}` }, credentials: { server, accessToken } };
    }
    if (!fields.username || !fields.password) throw new UserError("Enter a username and password, or an API key.");
    let data: { user: LoginUser };
    try {
      // x-return-tokens asks ABS 2.26+ for an access + refresh token pair; older servers send user.token.
      data = await absRequest(server, "POST", "/login", {
        headers: { "content-type": "application/json", "x-return-tokens": "true" },
        body: JSON.stringify({ username: fields.username, password: fields.password }),
      });
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401) throw new UserError("Wrong username or password.");
      throw new UserError(`Couldn't reach Audiobookshelf at ${server}.`);
    }
    const u = data.user;
    const accessToken = u.accessToken ?? u.token;
    if (!accessToken) throw new UserError("Audiobookshelf didn't return a login token.");
    return {
      account: { name: `${u.username} @ ${new URL(server).host}` },
      credentials: { server, accessToken, refreshToken: u.refreshToken, legacy: !u.accessToken },
    };
  },

  async sync(creds, rawCursor) {
    const saved = (rawCursor ?? {}) as Partial<Cursor>;
    const cursor: Cursor = { since: saved.since ?? 0, items: saved.items ?? {}, last: saved.last ?? {} };
    const now = Date.now();
    let current = creds;
    let refreshed = false;

    const me = async () => {
      const auth = { headers: { Authorization: `Bearer ${current.accessToken}` } };
      return absRequest<{ mediaProgress: MeProgress[] }>(current.server, "GET", "/api/me", auth);
    };

    let profile: { mediaProgress: MeProgress[] };
    try {
      profile = await me();
    } catch (e) {
      if ((e as { status?: number }).status !== 401 || !current.refreshToken) throw e;
      const r = await absRequest<{ user: LoginUser }>(current.server, "POST", "/auth/refresh", {
        headers: { "x-refresh-token": current.refreshToken, "x-return-tokens": "true" },
      });
      current = {
        ...current,
        accessToken: r.user.accessToken ?? current.accessToken,
        refreshToken: r.user.refreshToken ?? current.refreshToken,
      };
      refreshed = true;
      profile = await me();
    }

    // Books only. Report a book when its position changed since the last report: ABS sometimes
    // moves lastUpdate without the position moving, and sometimes the other way round.
    const books = profile.mediaProgress.filter((p) => !p.episodeId);
    const changed = books.filter((p) => bookProgress(p) !== cursor.last[p.libraryItemId]);
    const events: PluginEvent[] = [];
    for (const p of changed) {
      if (!(p.libraryItemId in cursor.items)) cursor.items[p.libraryItemId] = await bookInfo(current, p.libraryItemId);
      const book = cursor.items[p.libraryItemId];
      if (!book) continue; // podcast or deleted item
      const media = { kind: "audiobook" as const, ...book };
      const progress = bookProgress(p);
      // If ABS didn't move the timestamp, the change happened between our last sync and now.
      const at = p.lastUpdate > cursor.since ? p.lastUpdate : now;
      events.push({ media, kind: "progress", progress, occurredAt: msToIso(at) });
      if (p.isFinished) events.push({ media, kind: "finished", occurredAt: msToIso(p.finishedAt ?? at) });
      cursor.last[p.libraryItemId] = progress;
    }
    cursor.since = Math.max(cursor.since, ...books.map((p) => p.lastUpdate));
    return { events, cursor, credentials: refreshed ? current : undefined };
  },
});

async function bookInfo(creds: AbsCredentials, id: string) {
  try {
    const item = await absRequest<Item>(creds.server, "GET", `/api/items/${id}`, {
      headers: { Authorization: `Bearer ${creds.accessToken}` },
    });
    if (item.mediaType !== "book") return null;
    const m = item.media.metadata;
    return {
      title: m.title,
      author: m.authorName ?? m.authors?.map((a) => a.name).join(", "),
      asin: m.asin || undefined,
      isbn: m.isbn || undefined,
      year: Number(m.publishedYear) || undefined,
    };
  } catch (e) {
    if ((e as { status?: number }).status === 404) return null;
    throw e;
  }
}
