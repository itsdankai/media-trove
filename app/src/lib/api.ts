// Thin typed wrapper over the server's /api routes.
export type MediaKind = "movie" | "show" | "audiobook";

export type SearchResult = {
  key: string;
  kind: MediaKind;
  title: string;
  year: number | null;
  poster: string | null;
  overview: string | null;
  subtitle?: string;
};

export type Season = { number: number; name: string; episodeCount: number; airDate: string | null };
export type Episode = { season: number; number: number; name: string; airDate: string | null; still: string | null };

export type Media = Omit<SearchResult, "subtitle"> & {
  genres: string[];
  extra: {
    subtitle?: string | null;
    backdrop?: string | null;
    runtime?: number | null;
    seasons?: Season[];
    totalEpisodes?: number;
    airedEpisodes?: number;
    status?: string | null;
    nextEpisode?: { season: number; number: number; airDate: string } | null;
    authors?: string[];
    narrators?: string[];
    runtimeMin?: number | null;
    series?: { name: string; position: string | null } | null;
  };
};

export type TrackState = {
  status: "planned" | "watching" | "completed" | "listening" | "finished";
  lastActivityAt: string | null;
  watchCount?: number;
  watchedEpisodes?: string[];
  current?: { season: number; episode: number; progress: number } | null;
  progress?: number;
};

export type EventRow = {
  id: string;
  mediaKey: string;
  kind: "watched" | "unwatched" | "progress" | "finished";
  season: number | null;
  episode: number | null;
  progress: number | null;
  source: string;
  sourceName?: string;
  occurredAt: string;
};

export type NewEvent = Pick<EventRow, "mediaKey" | "kind"> & {
  season?: number;
  episode?: number;
  progress?: number;
};

export type Settings = { watchedThreshold: number; setupComplete: boolean };

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
  id: string;
  name: string;
  version: string;
  description: string;
  kinds: MediaKind[];
  homepage?: string;
  connect: { fields: Field[]; note?: string };
  sync: { intervalSeconds: number };
};

export type CatalogEntry = {
  id: string;
  name: string;
  description: string;
  kinds: MediaKind[];
  tags: string[];
  author: string;
  bundled?: boolean;
  manifestUrl?: string;
  connections: number;
};

export type SyncSummary = { received: number; added: number; unmatched: number; refused: number; at: number };

export type Connection = {
  id: string;
  pluginId: string;
  accountName: string;
  lastSyncAt: number | null;
  lastError: string | null;
  lastSummary: SyncSummary | null;
  syncing: boolean;
  followUnmarks: boolean;
  createdAt: number;
};

export type PluginStatus = {
  state: "stopped" | "starting" | "running" | "disconnected";
  pid?: number;
  lastError?: string;
  since: number;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

function send<T>(method: string, path: string, body?: unknown) {
  return call<T>(path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const api = {
  config: () => call<{ tmdb: boolean; plugins: boolean }>("/api/config"),
  search: (kind: MediaKind, q: string) => call<SearchResult[]>(`/api/search?${new URLSearchParams({ kind, q })}`),
  media: (key: string) => call<{ media: Media; state: TrackState; events: EventRow[] }>(`/api/media/${key}`),
  season: (key: string, n: number) => call<Episode[]>(`/api/media/${key}/season/${n}`),
  library: (kind?: MediaKind) =>
    call<{ media: Media; state: TrackState }[]>(`/api/library${kind ? `?kind=${kind}` : ""}`),
  history: (limit = 100) =>
    call<
      {
        event: EventRow;
        title: string | null;
        poster: string | null;
        mediaKind: MediaKind | null;
        sourceName: string;
      }[]
    >(`/api/history?limit=${limit}`),
  track: (e: NewEvent | NewEvent[]) => send<{ inserted: number }>("POST", "/api/events", e),
  settings: () => call<Settings>("/api/settings"),
  saveSettings: (patch: Partial<Settings>) => send<Settings>("PUT", "/api/settings", patch),
  marketplace: (q = "") => call<CatalogEntry[]>(`/api/marketplace?q=${encodeURIComponent(q)}`),
  addPluginUrl: (url: string) => send<{ id: string; name: string }>("POST", "/api/marketplace/custom", { url }),
  manifest: (id: string) => call<Manifest>(`/api/plugins/${id}/manifest`),
  pluginStatuses: () => call<Record<string, PluginStatus>>("/api/plugins"),
  connections: () => call<Connection[]>("/api/connections"),
  connect: (pluginId: string, fields: Record<string, string>) =>
    send<{ id: string; accountName: string }>("POST", "/api/connections", { pluginId, fields }),
  syncNow: (id: string) => send<SyncSummary>("POST", `/api/connections/${id}/sync`),
  resync: (id: string) => send<SyncSummary>("POST", `/api/connections/${id}/resync`),
  disconnect: (id: string) => fetch(`/api/connections/${id}`, { method: "DELETE" }),
  setFollowUnmarks: (id: string, followUnmarks: boolean) =>
    send<{ ok: true }>("PATCH", `/api/connections/${id}`, { followUnmarks }),
  imports: () => call<{ sources: ImportSourceInfo[]; history: ImportRun[]; simklClientId: boolean }>("/api/imports"),
  importFile: (source: string, file: File) => {
    const body = new FormData();
    body.append("file", file);
    return call<ImportJob>(`/api/imports/${source}`, { method: "POST", body });
  },
  importUser: (source: string, username: string) => send<ImportJob>("POST", `/api/imports/${source}`, { username }),
  importJob: (id: string) => call<ImportJob>(`/api/imports/jobs/${id}`),
  simklPin: (clientId?: string) =>
    send<{ userCode: string; url: string; expiresIn: number; interval: number }>("POST", "/api/imports/simkl/pin", {
      clientId,
    }),
  simklPinCheck: (code: string) =>
    send<{ ready: boolean; job?: ImportJob }>("POST", `/api/imports/simkl/pin/${encodeURIComponent(code)}`),
  removeImport: (source: string) => send<{ removed: number }>("DELETE", `/api/imports/${source}`),
};

export type ImportSourceInfo = { id: string; name: string; input: "file" | "username" | "simkl" };
export type ImportSummary = {
  received: number;
  added: number;
  titles: number;
  unmatched: number;
  skipped: number;
  alreadyTracked?: number;
};
export type ImportJob = {
  id: string;
  source: string;
  label: string;
  status: "running" | "done" | "failed";
  stage: string;
  done: number;
  total: number;
  summary: ImportSummary;
  unmatchedTitles: string[];
  notes: string[];
  error: string | null;
};
export type ImportRun = {
  id: string;
  source: string;
  label: string;
  startedAt: number;
  finishedAt: number;
  summary: ImportSummary;
  error: string | null;
};

export const kindLabel: Record<MediaKind, string> = { movie: "Movies", show: "Shows", audiobook: "Audiobooks" };
export const kindPath: Record<MediaKind, string> = { movie: "/movies", show: "/shows", audiobook: "/audiobooks" };

export const statusLabel: Record<TrackState["status"], string> = {
  planned: "Planned",
  watching: "Watching",
  completed: "Completed",
  listening: "Listening",
  finished: "Finished",
};

/** 0..1 completion for any kind, for progress bars. */
export function completion(m: Media, s: TrackState) {
  // Finished counts as 100% even when the app stopped at 99.6% (books finish at 99%).
  if (m.kind === "audiobook") return s.status === "finished" ? 1 : (s.progress ?? 0);
  if (m.kind === "show") {
    const total = m.extra.airedEpisodes || m.extra.totalEpisodes || 0;
    return total ? Math.min(1, (s.watchedEpisodes?.length ?? 0) / total) : 0;
  }
  if (s.progress) return s.progress;
  return s.watchCount ? 1 : 0;
}

export function formatMinutes(min: number | null | undefined) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}

export function timeAgo(ms: number | null) {
  if (!ms) return "never";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return new Date(ms).toLocaleDateString();
}
