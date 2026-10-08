import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router";
import { PosterCard, PosterGrid } from "@/components/PosterCard";
import { Skeleton } from "@/components/ui/skeleton";
import { api, kindLabel, type MediaKind } from "@/lib/api";
import { friendlyError } from "@/lib/errors";

const kinds: MediaKind[] = ["movie", "show", "audiobook"];

export function Search() {
  const [params] = useSearchParams();
  const q = params.get("q") ?? "";

  if (!q) return <p className="text-muted-foreground">Type in the search bar above to find something to track.</p>;

  return (
    <div className="space-y-10">
      <h1 className="text-2xl font-semibold tracking-tight">Results for “{q}”</h1>
      {kinds.map((kind) => (
        <Section key={kind} kind={kind} q={q} />
      ))}
    </div>
  );
}

function Section({ kind, q }: { kind: MediaKind; q: string }) {
  const { data, error, isLoading } = useQuery({ queryKey: ["search", kind, q], queryFn: () => api.search(kind, q) });

  return (
    <section className="space-y-4">
      <h2 className="text-lg font-medium">{kindLabel[kind]}</h2>
      {isLoading && (
        <PosterGrid>
          {Array.from({ length: 7 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholders
            <Skeleton key={i} className={kind === "audiobook" ? "aspect-square" : "aspect-[2/3]"} />
          ))}
        </PosterGrid>
      )}
      {error && (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{friendlyError(error)}</p>
      )}
      {data && data.length === 0 && <p className="text-sm text-muted-foreground">Nothing found.</p>}
      {data && data.length > 0 && (
        <PosterGrid>
          {data.slice(0, 14).map((r) => (
            <PosterCard
              key={r.key}
              to={`/media/${r.key}`}
              kind={r.kind}
              title={r.title}
              poster={r.poster}
              rated={{ mediaKey: r.key }}
              sub={[r.subtitle, r.year].filter(Boolean).join(" · ")}
            />
          ))}
        </PosterGrid>
      )}
    </section>
  );
}
