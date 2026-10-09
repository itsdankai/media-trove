import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, completion, type LibraryItem, type Media, onWatchlist, type Section } from "@/lib/api";

const tabs: { id: "all" | Section; label: string }[] = [
  { id: "all", label: "All" },
  { id: "movie", label: "Movies" },
  { id: "show", label: "Shows" },
  { id: "anime", label: "Anime" },
  { id: "audiobook", label: "Audiobooks" },
];

/** Same split as the library pages: anime (movies and shows) is its own section. */
const inSection = (s: Section, m: Media) =>
  s === "anime" ? m.kind !== "audiobook" && m.extra.anime === true : m.kind === s && m.extra.anime !== true;

/** Everything saved for later, in one place (builder, 2026-10-07): watch and listen lists together. */
export function Watchlist() {
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  const until = settings?.watchlistUntil ?? 0;
  return (
    <SavedPage
      title="Watchlist"
      counted="saved for later"
      pick={(i) => onWatchlist(i, until)}
      at={(i) => i.watchlistedAt}
      empty="Add to watchlist"
    />
  );
}

/** Starred titles (builder, 2026-10-09), started or not. */
export function Favorites() {
  return (
    <SavedPage
      title="Favorites"
      counted="favorites"
      pick={(i) => i.favoritedAt != null}
      at={(i) => i.favoritedAt}
      empty="Favorite"
    />
  );
}

function SavedPage({
  title,
  counted,
  pick,
  at,
  empty,
}: {
  title: string;
  counted: string;
  pick: (i: LibraryItem) => boolean;
  at: (i: LibraryItem) => number | null;
  empty: string;
}) {
  const [params, setParams] = useSearchParams();
  const tab = (params.get("type") ?? "all") as "all" | Section;
  const { data, isLoading } = useQuery({ queryKey: ["library"], queryFn: () => api.library() });
  const saved = (data ?? []).filter(pick).sort((a, b) => (at(b) ?? 0) - (at(a) ?? 0)); // newest first
  const count = (t: "all" | Section) => (t === "all" ? saved : saved.filter((i) => inSection(t, i.media))).length;
  const items = tab === "all" ? saved : saved.filter((i) => inSection(tab, i.media));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{data ? `${saved.length} ${counted}` : " "}</p>
        </div>
        <Tabs value={tab} onValueChange={(v) => setParams(v === "all" ? {} : { type: v }, { replace: true })}>
          <TabsList>
            {tabs.map((t) => (
              <TabsTrigger key={t.id} value={t.id}>
                {t.label}
                {data && count(t.id) > 0 && <span className="ml-1 text-muted-foreground">{count(t.id)}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      {!isLoading && items.length === 0 && (
        <div className="rounded-xl border border-dashed p-10 text-center text-muted-foreground">
          {saved.length === 0 ? "Nothing here yet. " : "Nothing here in this section yet. "}
          Find something with the search bar, open it, and press <span className="font-medium">{empty}</span>.{" "}
          <Link to="/search" className="text-primary underline-offset-4 hover:underline">
            Search
          </Link>
        </div>
      )}

      <PosterGrid>
        {items.map(({ media, state, favoritedAt }) => (
          <PosterCard
            key={media.key}
            to={`/media/${media.key}`}
            kind={media.kind}
            title={media.title}
            poster={media.poster}
            rated={{ mediaKey: media.key, anime: media.extra.anime, score: media.extra.rating }}
            starred={favoritedAt != null}
            progress={completion(media, state)}
            sub={[media.year, media.extra.authors?.[0]].filter(Boolean).join(" · ") || null}
          />
        ))}
      </PosterGrid>
    </div>
  );
}
