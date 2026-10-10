import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BookmarkMinus, BookmarkPlus, Check, ExternalLink, Star, StarOff } from "lucide-react";
import { useRef } from "react";
import { useNavigate } from "react-router";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { api, isOut, type LibraryItem, type MediaKind } from "@/lib/api";

/** What the poster menu needs to know about a title (from the library list). */
export type MenuInfo = {
  mediaKey: string;
  kind: MediaKind;
  watchlisted: boolean;
  favorited: boolean;
  done: boolean; // watched / finished / caught up: no "mark" item, and no "add to watchlist" (same as the title page)
  out: boolean; // released: nothing to mark before then (builder 2026-10-10)
};

/**
 * Right-click a poster (desktop) or long-press it (phone) for quick options (builder, 2026-10-09).
 * Radix opens the menu on both; the click that ends a long-press is swallowed so it doesn't also open the title.
 */
export function PosterMenu({ info, children }: { info: MenuInfo; children: React.ReactNode }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const openedAt = useRef(0);
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["library"] });
      qc.invalidateQueries({ queryKey: ["media", info.mediaKey] });
    },
  });
  const { mediaKey, kind } = info;
  const mark = info.done || !info.out ? null : kind === "movie" ? "watched" : kind === "audiobook" ? "finished" : null;

  return (
    <ContextMenu
      onOpenChange={(open) => {
        if (open) openedAt.current = Date.now();
      }}
    >
      <ContextMenuTrigger
        asChild
        // No phone link preview or text selection on a long-press.
        className="select-none [-webkit-touch-callout:none]"
        onClickCapture={(e) => {
          if (Date.now() - openedAt.current < 1000) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
      >
        <div>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuItem onSelect={() => navigate(`/media/${mediaKey}`)}>
          <ExternalLink /> Open
        </ContextMenuItem>
        <ContextMenuSeparator />
        {(info.watchlisted || !info.done) && (
          <ContextMenuItem onSelect={() => run.mutate(() => api.watchlist(mediaKey, !info.watchlisted))}>
            {info.watchlisted ? <BookmarkMinus /> : <BookmarkPlus />}
            {info.watchlisted ? "Remove from watchlist" : "Add to watchlist"}
          </ContextMenuItem>
        )}
        <ContextMenuItem onSelect={() => run.mutate(() => api.favorite(mediaKey, !info.favorited))}>
          {info.favorited ? <StarOff /> : <Star />}
          {info.favorited ? "Remove from favorites" : "Add to favorites"}
        </ContextMenuItem>
        {mark && (
          <ContextMenuItem onSelect={() => run.mutate(() => api.track({ mediaKey, kind: mark }))}>
            <Check /> {mark === "watched" ? "Mark watched" : "Mark finished"}
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}

/** The menu info for any title by key (calendar, Up next): from the library when it's there, otherwise a title
 *  you haven't touched yet (the server fetches it on demand, so it can still go on the watchlist). */
export const menuForKey = (library: LibraryItem[], key: string, kind: MediaKind, date?: string): MenuInfo => {
  const item = library.find((i) => i.media.key === key);
  const info = item
    ? menuFor(item)
    : { mediaKey: key, kind, watchlisted: false, favorited: false, done: false, out: true };
  return { ...info, out: info.out && isOut(date) };
};

/** The menu info for a library item. */
export const menuFor = (i: {
  media: { key: string; kind: MediaKind; extra?: { releaseDate?: string | null } };
  state: { status: string };
  watchlistedAt: number | null;
  favoritedAt: number | null;
}): MenuInfo => ({
  mediaKey: i.media.key,
  kind: i.media.kind,
  watchlisted: i.watchlistedAt != null,
  favorited: i.favoritedAt != null,
  done: ["completed", "finished", "caught_up"].includes(i.state.status),
  out: isOut(i.media.extra?.releaseDate),
});
