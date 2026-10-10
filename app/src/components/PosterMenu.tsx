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
import { api, type MediaKind } from "@/lib/api";

/** What the poster menu needs to know about a title (from the library list). */
export type MenuInfo = {
  mediaKey: string;
  kind: MediaKind;
  watchlisted: boolean;
  favorited: boolean;
  done: boolean; // watched / finished: no "mark" item
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
  const mark = info.done ? null : kind === "movie" ? "watched" : kind === "audiobook" ? "finished" : null;

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
        <ContextMenuItem onSelect={() => run.mutate(() => api.watchlist(mediaKey, !info.watchlisted))}>
          {info.watchlisted ? <BookmarkMinus /> : <BookmarkPlus />}
          {info.watchlisted ? "Remove from watchlist" : "Add to watchlist"}
        </ContextMenuItem>
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

/** The menu info for a library item. */
export const menuFor = (i: {
  media: { key: string; kind: MediaKind };
  state: { status: string };
  watchlistedAt: number | null;
  favoritedAt: number | null;
}): MenuInfo => ({
  mediaKey: i.media.key,
  kind: i.media.kind,
  watchlisted: i.watchlistedAt != null,
  favorited: i.favoritedAt != null,
  done: i.state.status === "completed" || i.state.status === "finished",
});
