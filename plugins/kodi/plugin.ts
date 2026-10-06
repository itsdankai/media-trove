// Kodi: reads played and in-progress movies and episodes over Kodi's JSON-RPC web interface
// (Settings → Services → Control → "Allow remote control via HTTP"). Only Get* methods are called.
// Kodi has no login tokens, so the web-interface username and password are kept (encrypted).
import { definePlugin, getJson, type Manifest, type MediaRef, UserError } from "../_sdk/index.ts";
import { diffSnapshot, type Entry, type SnapshotCursor } from "../_sdk/snapshot.ts";

export const manifest: Manifest = {
  contract: 1,
  id: "kodi",
  name: "Kodi",
  version: "0.1.0",
  description: "Track movies and episodes you watch in Kodi.",
  kinds: ["movie", "show"],
  homepage: "https://kodi.tv",
  connect: {
    fields: [
      { key: "server", label: "Kodi address", type: "url", required: true, placeholder: "http://192.168.1.20:8080" },
      { key: "username", label: "Web interface username", type: "text", default: "kodi" },
      {
        key: "password",
        label: "Web interface password",
        type: "password",
        help: "Kodi has no sign-in tokens, so this is kept, encrypted, to read your library.",
      },
    ],
    note: "Turn on Settings → Services → Control → Allow remote control via HTTP in Kodi first.",
  },
  sync: { intervalSeconds: 180 }, // servers on your own network: cheap to ask often
};

type Creds = { server: string; username?: string; password?: string };

const READ_ONLY = new Set([
  "JSONRPC.Ping",
  "VideoLibrary.GetMovies",
  "VideoLibrary.GetTVShows",
  "VideoLibrary.GetEpisodes",
]);

export function assertReadOnly(method: string) {
  if (!READ_ONLY.has(method)) throw new Error(`Kodi plugin is read-only: refused ${method}`);
}

async function rpc<T>(c: Creds, method: string, params: object = {}): Promise<T> {
  assertReadOnly(method);
  const auth: Record<string, string> = c.username
    ? { Authorization: `Basic ${Buffer.from(`${c.username}:${c.password ?? ""}`).toString("base64")}` }
    : {};
  const r = await getJson<{ result?: T; error?: { message: string } }>(
    `${c.server}/jsonrpc`,
    {
      method: "POST",
      headers: { "content-type": "application/json", ...auth },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
    60_000,
  );
  if (r.error) throw new Error(`Kodi ${method}: ${r.error.message}`);
  return r.result as T;
}

type Resume = { position: number; total: number };
type Movie = {
  movieid: number;
  title: string;
  year?: number;
  playcount: number;
  lastplayed?: string;
  resume?: Resume;
  uniqueid?: Record<string, string>;
  imdbnumber?: string;
};
type Show = { tvshowid: number; title: string; year?: number; uniqueid?: Record<string, string>; imdbnumber?: string };
type Episode = {
  episodeid: number;
  tvshowid: number;
  season: number;
  episode: number;
  playcount: number;
  lastplayed?: string;
  resume?: Resume;
};

export function refFromKodi(
  kind: "movie" | "show",
  x: { title: string; year?: number; uniqueid?: Record<string, string>; imdbnumber?: string },
): MediaRef {
  const u = x.uniqueid ?? {};
  const num = (v?: string) => (v && /^\d+$/.test(v) ? Number(v) : undefined);
  const imdb = u.imdb ?? (x.imdbnumber?.startsWith("tt") ? x.imdbnumber : undefined);
  return { kind, imdb, tmdb: num(u.tmdb), tvdb: num(u.tvdb), title: x.title, year: x.year || undefined };
}

/** Kodi's "2026-10-06 01:02:03" is local time without a zone; good enough for ordering. */
const kodiTime = (s?: string) => (s ? new Date(s.replace(" ", "T")).toISOString() : null);

export default definePlugin<Creds>({
  manifest,

  async connect(fields) {
    const server = (fields.server ?? "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(server)) throw new UserError("Kodi address must start with http://");
    const creds: Creds = {
      server,
      username: fields.username?.trim() || undefined,
      password: fields.password || undefined,
    };
    try {
      await rpc(creds, "JSONRPC.Ping");
    } catch (e) {
      if ((e as { status?: number }).status === 401) throw new UserError("Kodi rejected that username or password.");
      throw new UserError(`Couldn't reach Kodi at ${server}. Is "Allow remote control via HTTP" on?`);
    }
    return { account: { name: `Kodi @ ${new URL(server).host}` }, credentials: creds };
  },

  async sync(creds, rawCursor) {
    const movieProps = ["title", "year", "playcount", "lastplayed", "resume", "uniqueid", "imdbnumber"];
    const { movies = [] } = await rpc<{ movies?: Movie[] }>(creds, "VideoLibrary.GetMovies", {
      properties: movieProps,
    });
    const { tvshows = [] } = await rpc<{ tvshows?: Show[] }>(creds, "VideoLibrary.GetTVShows", {
      properties: ["title", "year", "uniqueid", "imdbnumber"],
    });
    const { episodes = [] } = await rpc<{ episodes?: Episode[] }>(creds, "VideoLibrary.GetEpisodes", {
      properties: ["tvshowid", "season", "episode", "playcount", "lastplayed", "resume"],
    });
    const shows = new Map(tvshows.map((s) => [s.tvshowid, s]));
    const position = (r?: Resume) => (r && r.total > 0 && r.position > 0 ? r.position / r.total : null);

    const entries: Entry[] = movies.map((m) => ({
      id: `movie:${m.movieid}`,
      media: refFromKodi("movie", m),
      played: m.playcount > 0,
      playCount: m.playcount,
      lastPlayed: kodiTime(m.lastplayed),
      position: position(m.resume),
    }));
    for (const e of episodes) {
      const show = shows.get(e.tvshowid);
      if (!show || e.season < 1) continue;
      entries.push({
        id: `episode:${e.episodeid}`,
        media: refFromKodi("show", show),
        season: e.season,
        episode: e.episode,
        played: e.playcount > 0,
        playCount: e.playcount,
        lastPlayed: kodiTime(e.lastplayed),
        position: position(e.resume),
      });
    }
    return diffSnapshot(entries, rawCursor as SnapshotCursor);
  },
});
