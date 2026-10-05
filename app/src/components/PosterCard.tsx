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

export function PosterCard({ to, kind, title, poster, sub, progress, badge }: Props) {
  return (
    <Link to={to} className="group block focus:outline-none">
      <div className="relative transition-transform duration-200 group-hover:-translate-y-1 group-focus-visible:ring-2 group-focus-visible:ring-ring rounded-lg">
        <Poster src={poster} kind={kind} title={title} className="shadow-lg shadow-black/30" />
        {badge && (
          <span className="absolute left-2 top-2 rounded-md bg-background/85 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide backdrop-blur">
            {badge}
          </span>
        )}
        {progress != null && progress > 0 && (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
            <div className="h-full bg-primary" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </div>
      <p className="mt-2 line-clamp-1 text-sm font-medium">{title}</p>
      {sub && <p className="line-clamp-1 text-xs text-muted-foreground">{sub}</p>}
    </Link>
  );
}

export function PosterGrid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-x-4 gap-y-6 sm:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">{children}</div>
  );
}
