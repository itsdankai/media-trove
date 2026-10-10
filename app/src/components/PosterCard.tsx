import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import { Clapperboard, Headphones, Star, Tv } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { type MenuInfo, PosterMenu } from "@/components/PosterMenu";
import { api, type MediaKind } from "@/lib/api";

const fallbackIcon = { movie: Clapperboard, show: Tv, audiobook: Headphones };

/** What a poster needs to show a rating on it (Settings → Rating posters). */
export type Rated = { mediaKey: string; anime?: boolean; score?: number | null };

/** Whether rating posters are on, and whether the server can fetch RPDB ones. */
function useRatingPosters() {
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings, staleTime: 60_000 });
  const { data: config } = useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: 300_000 });
  return { on: settings?.ratingPosters ?? false, rpdb: config?.rpdb ?? false };
}

const PHONE = "(max-width: 639px)";
/** True at phone width; follows rotation and resizing. */
function usePhone() {
  return useSyncExternalStore(
    (onChange) => {
      const q = window.matchMedia(PHONE);
      q.addEventListener("change", onChange);
      return () => q.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE).matches,
  );
}

export function Poster({
  src,
  kind,
  title,
  className,
  rated,
  starred,
  plainOnPhone,
}: {
  src: string | null;
  kind: MediaKind;
  title: string;
  className?: string;
  rated?: Rated;
  starred?: boolean;
  /** Grid cards: at phone width the RPDB strip's three scores are too small to read, so show the plain poster. */
  plainOnPhone?: boolean;
}) {
  const Icon = fallbackIcon[kind];
  const { on: ratingPosters, rpdb } = useRatingPosters();
  const phone = usePhone();
  const on = ratingPosters && !(plainOnPhone && phone);
  const [rpdbFailed, setRpdbFailed] = useState(false);
  // Anime: RPDB only knows IMDb / Rotten Tomatoes, so draw the anime community score (MAL, AniList…) instead.
  const animeScore = on && rated?.anime && rated.score ? rated.score : null;
  const rpdbSrc =
    on && rpdb && rated && !rated.anime && !rpdbFailed && /^tmdb-(movie|show)-\d+$/.test(rated.mediaKey)
      ? `/api/poster/${rated.mediaKey}`
      : null;
  const shown = rpdbSrc ?? src;
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-muted ring-1 ring-border",
        kind === "audiobook" ? "aspect-square" : "aspect-[2/3]",
        className,
      )}
    >
      {shown ? (
        <img
          src={shown}
          alt={title}
          loading="lazy"
          className="size-full object-cover"
          onError={rpdbSrc ? () => setRpdbFailed(true) : undefined}
        />
      ) : (
        <div className="grid size-full place-items-center text-muted-foreground">
          <Icon className="size-8" />
        </div>
      )}
      {animeScore != null && (
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 bg-black/75 py-1 text-xs font-semibold text-white">
          <Star className="size-3 fill-amber-400 text-amber-400" />
          {animeScore.toFixed(1)}
          <span className="font-normal text-white/70">/10 anime</span>
        </div>
      )}
      {starred && (
        <span
          title="Favorite"
          className="absolute top-1.5 right-1.5 grid size-6 place-items-center rounded-full bg-black/70 ring-1 ring-white/15"
        >
          <Star className="size-3.5 fill-amber-400 text-amber-400" aria-label="Favorite" />
        </span>
      )}
    </div>
  );
}

type Props = {
  to: string;
  kind: MediaKind;
  title: string;
  poster: string | null;
  sub?: string | null;
  progress?: number;
  badge?: string;
  rated?: Rated;
  starred?: boolean;
  /** Right-click / long-press options; left out where the page doesn't know the title's lists (search). */
  menu?: MenuInfo;
};

// Status and progress sit underneath the artwork; only a rating poster (Settings) and the favorite star draw on it.
export function PosterCard({ to, kind, title, poster, sub, progress, badge, rated, starred, menu }: Props) {
  const showBar = progress != null && progress > 0 && progress < 1;
  const card = (
    <Link to={to} className="group block focus:outline-none">
      <div className="fx-lift rounded-lg transition-transform duration-200 group-hover:-translate-y-1 group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <Poster
          src={poster}
          kind={kind}
          title={title}
          rated={rated}
          starred={starred}
          plainOnPhone
          className="shadow-lg shadow-black/30"
        />
      </div>
      <div className={cn("fx-meter mt-1.5 h-1 overflow-hidden rounded-full bg-muted", !showBar && "invisible")}>
        <div className="h-full bg-primary" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
      </div>
      {/* Two lines, so sequels and editions can be told apart (Astra critique 2026-10-09). */}
      <p className="mt-1.5 line-clamp-2 text-sm leading-snug font-medium">{title}</p>
      {(badge || sub) && (
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {badge && <span className="font-medium text-primary">{badge}</span>}
          {badge && sub && " · "}
          {sub}
        </p>
      )}
    </Link>
  );
  return menu ? <PosterMenu info={menu}>{card}</PosterMenu> : card;
}

export function PosterGrid({ children, twoRows }: { children: React.ReactNode; twoRows?: boolean }) {
  return (
    <div
      className={cn(
        "grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7",
        // Home rows: never more than two rows, however many columns this screen width has (3, 4, 6 or 7).
        // Hide from the 7th on, then each wider screen shows back only its own extra posters. Every "show"
        // rule has a :not(), which makes it more specific than the "hide" rule wherever Tailwind puts it.
        twoRows &&
          "[&>*:nth-child(n+7)]:hidden sm:[&>*:nth-child(n+7):not(:nth-child(n+9))]:block lg:[&>*:nth-child(n+9):not(:nth-child(n+13))]:block xl:[&>*:nth-child(n+13):not(:nth-child(n+15))]:block",
      )}
    >
      {children}
    </div>
  );
}
