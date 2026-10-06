import { cn } from "cn";
import { Clapperboard, Headphones, Tv } from "lucide-react";
import { Link } from "react-router";
import type { MediaKind } from "@/lib/api";

const fallbackIcon = { movie: Clapperboard, show: Tv, audiobook: Headphones };

export function Poster({
  src,
  kind,
  title,
  className,
}: {
  src: string | null;
  kind: MediaKind;
  title: string;
  className?: string;
}) {
  const Icon = fallbackIcon[kind];
  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg bg-muted ring-1 ring-border",
        kind === "audiobook" ? "aspect-square" : "aspect-[2/3]",
        className,
      )}
    >
      {src ? (
        <img src={src} alt={title} loading="lazy" className="size-full object-cover" />
      ) : (
        <div className="grid size-full place-items-center text-muted-foreground">
          <Icon className="size-8" />
        </div>
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
};

// Nothing is drawn on top of the artwork: the status and progress sit underneath it.
export function PosterCard({ to, kind, title, poster, sub, progress, badge }: Props) {
  const showBar = progress != null && progress > 0 && progress < 1;
  return (
    <Link to={to} className="group block focus:outline-none">
      <div className="rounded-lg transition-transform duration-200 group-hover:-translate-y-1 group-focus-visible:ring-2 group-focus-visible:ring-ring">
        <Poster src={poster} kind={kind} title={title} className="shadow-lg shadow-black/30" />
      </div>
      <div className={cn("mt-1.5 h-1 overflow-hidden rounded-full bg-muted", !showBar && "invisible")}>
        <div className="h-full bg-primary" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} />
      </div>
      <p className="mt-1.5 line-clamp-1 text-sm font-medium">{title}</p>
      {(badge || sub) && (
        <p className="line-clamp-1 text-xs text-muted-foreground">
          {badge && <span className="font-medium text-primary">{badge}</span>}
          {badge && sub && " · "}
          {sub}
        </p>
      )}
    </Link>
  );
}

export function PosterGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">{children}</div>
  );
}
