import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, type Media, type Section } from "@/lib/api";

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
  const [params, setParams] = useSearchParams();
  const tab = (params.get("type") ?? "all") as "all" | Section;
  const { data, isLoading } = useQuery({ queryKey: ["library"], queryFn: () => api.library() });
  // Saved and not started yet; starting a title moves it to its library page by itself.
  const saved = (data ?? [])
    .filter((i) => i.state.status === "planned" && i.watchlistedAt != null)
    .sort((a, b) => (b.watchlistedAt ?? 0) - (a.watchlistedAt ?? 0)); // newest saved first
  const count = (t: "all" | Section) => (t === "all" ? saved : saved.filter((i) => inSection(t, i.media))).length;
  const items = tab === "all" ? saved : saved.filter((i) => inSection(tab, i.media));

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Watchlist</h1>
          <p className="text-sm text-muted-foreground">{data ? `${saved.length} saved for later` : " "}</p>
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
          {saved.length === 0 ? "Nothing saved yet. " : "Nothing saved here yet. "}
          Find something with the search bar, open it, and press <span className="font-medium">Add to watchlist</span>.{" "}
          <Link to="/search" className="text-primary underline-offset-4 hover:underline">
            Search
          </Link>
        </div>
      )}

      <PosterGrid>
        {items.map(({ media }) => (
          <PosterCard
            key={media.key}
            to={`/media/${media.key}`}
            kind={media.kind}
            title={media.title}
            poster={media.poster}
            rated={{ mediaKey: media.key, anime: media.extra.anime, score: media.extra.rating }}
            sub={[media.year, media.extra.authors?.[0]].filter(Boolean).join(" · ") || null}
          />
        ))}
      </PosterGrid>
    </div>
  );
}
