# MediaTrove

A self-hosted tracker for everything you watch and listen to: movies, TV shows, and
audiobooks first, with more media types to come.

- A clean library for each category, plus a calendar of upcoming releases.
- A **plugin marketplace**: search for your service (Stremio, Nuvio, Audiobookshelf, Plex,
  Jellyfin, Emby, Kodi…), enter your server and login or API key, and it tracks automatically.
- One-time imports from Trakt, Simkl, AniList, MyAnimeList, Letterboxd, and IMDb.

**Status:** early development. Manual tracking, the plugins listed above, and one-time imports
work. Filters, the calendar and an Anime section are next.

## Run it

```sh
cp .env.example .env   # add a free TMDB key for movies and shows
docker compose up -d   # then open http://localhost:8787
```

Your library is stored in `./data`. Back up that folder.

Audiobook search uses Audible's public catalog and needs no key. Set `AUDIBLE_REGION` to search another store.

Imports live on the Import page. Trakt, Letterboxd and IMDb read the export file each service
lets you download. AniList and MyAnimeList read a public profile by username. Simkl signs in
with a code; it needs the client ID of a free app from simkl.com/settings/developer, either
typed into the form or set once as `SIMKL_CLIENT_ID`.

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
