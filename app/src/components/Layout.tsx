import { useQuery } from "@tanstack/react-query";
import { cn } from "cn";
import {
  Bookmark,
  CalendarDays,
  Clapperboard,
  FileUp,
  Headphones,
  History,
  House,
  Menu,
  Search as SearchIcon,
  Settings as SettingsIcon,
  Sparkles,
  Store,
  Tv,
} from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { api } from "@/lib/api";
import { applyLook } from "@/lib/themes";

const nav = [
  { to: "/", label: "Home", icon: House, end: true },
  { to: "/movies", label: "Movies", icon: Clapperboard },
  { to: "/shows", label: "Shows", icon: Tv },
  { to: "/anime", label: "Anime", icon: Sparkles },
  { to: "/audiobooks", label: "Audiobooks", icon: Headphones },
  { to: "/watchlist", label: "Watchlist", icon: Bookmark },
  { to: "/calendar", label: "Calendar", icon: CalendarDays },
  { to: "/history", label: "History", icon: History },
];

const navMore = [
  { to: "/marketplace", label: "Marketplace", icon: Store, end: false },
  { to: "/import", label: "Import", icon: FileUp, end: false },
  { to: "/settings", label: "Settings", icon: SettingsIcon, end: false },
];

export function Layout() {
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const { data: settings } = useQuery({ queryKey: ["settings"], queryFn: api.settings });
  // The saved look (Settings → Appearance), kept in step with the server's copy.
  useEffect(() => {
    if (settings) applyLook(settings);
  }, [settings]);

  // First run: send people to setup until they've saved it once.
  useEffect(() => {
    if (settings && !settings.setupComplete) navigate("/setup", { replace: true });
  }, [settings, navigate]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
  }

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[15rem_1fr]">
      <div className="fx-ambient" aria-hidden="true" />
      <aside className="hidden md:flex flex-col gap-1 border-r bg-card/40 p-4 sticky top-0 h-dvh">
        <Link
          to="/"
          className="mb-5 flex items-center gap-2 rounded-lg px-2 pb-1 pt-1 hover:opacity-90"
          aria-label="MediaTrove home"
        >
          <img src="/assets/icon.png" alt="" className="size-7" />
          <span className="text-lg font-semibold tracking-tight">MediaTrove</span>
        </Link>
        {[...nav, ...navMore].map(({ to, label, icon: Icon, end }, i) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
                isActive && "bg-accent text-foreground font-medium",
                i === nav.length && "mt-4",
              )
            }
          >
            <Icon className="size-4" />
            {label}
          </NavLink>
        ))}
        <div className="mt-auto space-y-1.5 px-2 text-xs leading-snug text-muted-foreground">
          {/* TMDB's terms ask for its logo and this notice, less prominent than our own branding. */}
          <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer" className="block w-fit">
            <img src="/tmdb.svg" alt="TMDB" className="h-2.5" />
          </a>
          <p>This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
          <p>
            Anime data:{" "}
            <a
              href="https://github.com/manami-project/anime-offline-database"
              target="_blank"
              rel="noreferrer"
              className="underline-offset-2 hover:underline"
            >
              anime-offline-database
            </a>{" "}
            (ODbL).
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col pb-20 md:pb-0">
        <header className="sticky top-0 z-20 border-b bg-background/80 px-4 py-3 backdrop-blur md:px-8">
          <div className="mx-auto flex max-w-xl items-center gap-2">
            <form onSubmit={submit} className="relative flex-1">
              <SearchIcon className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search movies, shows, audiobooks…"
                className="pl-9"
                aria-label="Search"
              />
            </form>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">
          <Outlet />
        </main>
      </div>

      <PhoneNav />
    </div>
  );
}

const tab = "flex flex-col items-center gap-1 py-2 text-xs text-muted-foreground";

/** Phone: one row of the first four pages, and "More" for the rest (critique 2026-10-08: eight tabs made two rows). */
function PhoneNav() {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const rest = [...nav.slice(4), ...navMore];
  const inRest = rest.some(({ to }) => pathname.startsWith(to));

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {nav.slice(0, 4).map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} className={({ isActive }) => cn(tab, isActive && "text-primary")}>
          <Icon className="size-5" />
          {label}
        </NavLink>
      ))}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger className={cn(tab, inRest && "text-primary")}>
          <Menu className="size-5" />
          More
        </SheetTrigger>
        <SheetContent side="bottom" className="rounded-t-xl pb-[calc(env(safe-area-inset-bottom)+1rem)]">
          <SheetHeader>
            <SheetTitle>More</SheetTitle>
          </SheetHeader>
          <div className="grid grid-cols-3 gap-2 px-4">
            {rest.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                onClick={() => setOpen(false)}
                className={({ isActive }) =>
                  cn(
                    "flex flex-col items-center gap-1.5 rounded-lg py-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                    isActive && "bg-accent text-foreground font-medium",
                  )
                }
              >
                <Icon className="size-5" />
                {label}
              </NavLink>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </nav>
  );
}
