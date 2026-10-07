# MediaTrove

A self-hosted tracker for everything you watch and listen to: movies, TV shows, anime and
audiobooks, with more media types to come.

- **Your library**, one page per kind, with filters (status, genre, year, rating, tags).
- **A plugin marketplace.** Connect Stremio, Nuvio, Plex, Jellyfin, Emby, Kodi or Audiobookshelf
  with your server and login, and what you watch is tracked automatically. Stremio, Nuvio and Jellyfin
  can also be kept in sync: mark something in MediaTrove and it's marked there too.
- **A release calendar** of new episodes, sequels and audiobooks from authors you follow.
- **One-time imports** from Trakt, Simkl, MyAnimeList, Letterboxd, IMDb and Netflix.
- **Backups**: download everything as one file, and a copy is saved every week.

**Status:** v0.1, early but complete for movies, shows, anime and audiobooks.

## Run it

You need Docker. In an empty folder:

```sh
curl -O https://raw.githubusercontent.com/itsdankai/media-trove/main/compose.yaml
curl -o .env https://raw.githubusercontent.com/itsdankai/media-trove/main/.env.example
```

Open `.env` and set `TMDB_API_KEY` (free: themoviedb.org, then Settings, then API). If anyone but you
can reach this machine, also set `MEDIATROVE_PASSWORD`. Then:

```sh
docker compose up -d
```

Open http://localhost:8787 (or this machine's address, port 8787). The first screen asks one
question, then you're in. Your library lives in `./data` next to `compose.yaml`.

To update later: `docker compose pull && docker compose up -d`.

**Stable or nightly.** `compose.yaml` runs `:latest`, which only changes when a version is released.
To try the newest work before release, change the image to `ghcr.io/itsdankai/media-trove:nightly`
(rebuilt on every change; may have rough edges). Your data works with both.

## Settings

All optional except the TMDB key. Put them in `.env` and run `docker compose up -d` again.

| Setting | What it does |
|---|---|
| `TMDB_API_KEY` | Movie and show data. Required. The v3 "API Key" or the v4 "Read Access Token" both work. |
| `MEDIATROVE_PASSWORD` | Asks for this password before showing anything (any username works). **Set it whenever MediaTrove is reachable by anyone but you**, and put HTTPS in front of it (a reverse proxy) if it's reachable from the internet. |
| `RPDB_API_KEY` | Rating posters for movies and shows: the poster with IMDb and Rotten Tomatoes scores drawn on it, from [RPDB](https://ratingposterdb.com). Anime shows its community score (MyAnimeList, AniList and others) without a key. Switch both off in Settings → Display. |
| `AUDIBLE_REGION` | Which Audible store to search for audiobooks: us, uk, ca, au, de, fr, it, es, in, jp. Default us. |
| `SIMKL_CLIENT_ID` | For the Simkl import, so the form doesn't ask for it (a free app from simkl.com/settings/developer). |
| `RESEND_API_KEY`, `MEDIATROVE_BACKUP_EMAIL_TO`, `MEDIATROVE_BACKUP_EMAIL_FROM` | Email the weekly backup through [Resend](https://resend.com) (free tier: 3,000 emails a month). The sender must be on a domain you've verified with Resend. |
| `MEDIATROVE_SECRET_KEY` | The key that encrypts your app logins. Normally created for you in `data/secret.key`; set this (32 bytes, base64) only if you'd rather keep it out of the data folder. |

## Connecting apps

Open **Marketplace**, pick your app, and sign in. MediaTrove keeps a session token (encrypted), never
your password. For apps that support it, choose how to keep them in sync:

- **Off:** MediaTrove only reads.
- **Add only** (recommended): your marks are added to the app; nothing there is ever unmarked.
- **Full:** your latest action wins both ways, including unmarks.

Anything already marked in the app comes into MediaTrove first. Turning sync on for an existing
connection shows what it would add before it does anything, with an option to only send new marks.

## Imports

**Import** page. Trakt, Letterboxd, IMDb and Netflix read the export file each service lets you download
(Netflix: a profile's "Viewing activity" download, or the "Get my info" ZIP, which covers every profile).
MyAnimeList reads a public profile by username. Simkl signs in with a code. Running an import again
only adds what's new, and each import can be undone.

## Backups

**Settings, then Backups:** download everything as one file, or restore from one. A copy is also
saved every week in `data/backups` (the last 8 are kept). App logins aren't in backups: reconnect
your apps after restoring. Backing up the whole `data` folder covers everything, logins included.

## Hosting it for friends

Each MediaTrove is one person's library. To host it for others, run one copy per person: a folder
each with its own `compose.yaml`, `.env` (with its own `MEDIATROVE_PASSWORD`) and `data`, and a
different port each (change `"8787:8787"` to `"8788:8787"` and so on), or one subdomain each behind
your reverse proxy. Their data lives on your server, in their folder. Accounts inside one copy are
planned for after v0.1.

## Writing a plugin

See [docs/plugins.md](docs/plugins.md). A plugin is a small web service with three routes (four if it
can keep its app in sync), in any language.

## Develop

```sh
pnpm install
pnpm dev     # UI on http://localhost:5173, API on :8787
pnpm test
```

Stack: TypeScript, Hono, Drizzle + SQLite, React, Tailwind, shadcn/ui.

## Licence and credits

MediaTrove is free software under the [GNU AGPL v3](LICENSE): you can use, change and share it, and
if you run a changed version for others, you share your changes too.

Data sources and their terms: [docs/metadata-terms.md](docs/metadata-terms.md).

- Movie and show data comes from [TMDB](https://www.themoviedb.org). This product uses the TMDB API but
  is not endorsed or certified by TMDB.
- Audiobook data comes from Audible's public catalog.
- Anime genres, tags and scores come from
  [anime-offline-database](https://github.com/manami-project/anime-offline-database) by manami-project,
  under the [ODbL](https://opendatacommons.org/licenses/odbl/1-0/).
- Anime id mapping: [Anime-Lists](https://github.com/Anime-Lists/anime-lists) and
  [Fribb/anime-lists](https://github.com/Fribb/anime-lists).
