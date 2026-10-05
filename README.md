# MediaTrove

A self-hosted tracker for everything you watch and listen to: movies, TV shows, and
audiobooks first, with more media types to come.

- A clean library for each category, plus a calendar of upcoming releases.
- A **plugin marketplace**: search for your service (Stremio, Nuvio, Audiobookshelf, Plex,
  Jellyfin, Emby, Kodi…), enter your server and login or API key, and it tracks automatically.
- One-time imports from Trakt, Simkl, AniList, MyAnimeList, Letterboxd, and IMDb.

**Status:** early development. Manual tracking of movies, shows, and audiobooks works.
Plugins and imports are next.

## Run it

```sh
cp .env.example .env   # add a free TMDB key for movies and shows
docker compose up -d   # then open http://localhost:8787
```

Your library is stored in `./data`. Back up that folder.

Audiobook search uses Audible's public catalog and needs no key. Set `AUDIBLE_REGION` to search another store.

## Develop

```sh
pnpm install
pnpm dev     # UI on http://localhost:5173, API on :8787
pnpm test
```

Stack: TypeScript, Hono, Drizzle + SQLite, React, Tailwind, shadcn/ui.

---

Movie and show data comes from [TMDB](https://www.themoviedb.org). This product uses the TMDB
API but is not endorsed or certified by TMDB.
