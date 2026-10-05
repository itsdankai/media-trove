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
  occurredAt: string;
};

export type NewEvent = Pick<EventRow, "mediaKey" | "kind"> & {
  season?: number;
  episode?: number;
  progress?: number;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  config: () => call<{ tmdb: boolean }>("/api/config"),
  search: (kind: MediaKind, q: string) => call<SearchResult[]>(`/api/search?${new URLSearchParams({ kind, q })}`),
  media: (key: string) => call<{ media: Media; state: TrackState; events: EventRow[] }>(`/api/media/${key}`),
  season: (key: string, n: number) => call<Episode[]>(`/api/media/${key}/season/${n}`),
  library: (kind?: MediaKind) =>
    call<{ media: Media; state: TrackState }[]>(`/api/library${kind ? `?kind=${kind}` : ""}`),
  history: (limit = 100) =>
    call<{ event: EventRow; title: string | null; poster: string | null; mediaKind: MediaKind | null }[]>(
      `/api/history?limit=${limit}`,
    ),
  track: (e: NewEvent | NewEvent[]) =>
    call<{ inserted: number }>("/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(e),
    }),
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
  if (m.kind === "audiobook") return s.progress ?? 0;
  if (m.kind === "show") {
    const total = m.extra.airedEpisodes || m.extra.totalEpisodes || 0;
    return total ? Math.min(1, (s.watchedEpisodes?.length ?? 0) / total) : 0;
  }
  return s.watchCount ? 1 : 0;
}

export function formatMinutes(min: number | null | undefined) {
  if (!min) return null;
  const h = Math.floor(min / 60);
  return h ? `${h}h ${min % 60}m` : `${min}m`;
}
