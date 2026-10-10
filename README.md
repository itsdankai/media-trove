<p align="center"><img src="app/public/assets/logo.png" alt="MediaTrove logo" width="160" /></p>

# MediaTrove

A self-hosted tracker for everything you watch and listen to: movies, TV shows, anime and
audiobooks, with more media types to come.

- **Your library**, one page per kind, with filters (status, genre, year, rating, tags).
- **Plugins for your apps.** Connect Stremio, Nuvio, Plex, Jellyfin, Emby, Kodi or Audiobookshelf
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

Open `.env` and fill in:

- `TMDB_API_KEY` (**required**, free: themoviedb.org, then Settings, then API). Without it, movies and shows can't be found or synced.
- `RPDB_API_KEY` (optional, from [ratingposterdb.com](https://ratingposterdb.com)) for posters with IMDb and Rotten Tomatoes scores on them.

Then:

```sh
docker compose up -d
```

Open http://localhost:8787 (or this machine's address, port 8787). The first screen makes your
account (the admin), the next asks one question, then you're in. Everything lives in `./data` next to
`compose.yaml`. Make that first account straight away: until it exists, whoever opens the page first
can claim the server.

To update later: `docker compose pull && docker compose up -d`.

**Stable or nightly.** `compose.yaml` runs `:latest`, which only changes when a version is released.
To try the newest work before release, change the image to `ghcr.io/itsdankai/media-trove:nightly`
(rebuilt on every change; may have rough edges). Your data works with both.

## Settings

All optional except the TMDB key. Put them in `.env` and run `docker compose up -d` again.

| Setting | What it does |
|---|---|
| `TMDB_API_KEY` | Movie and show data. Required. The v3 "API Key" or the v4 "Read Access Token" both work. |
| `MEDIATROVE_URL` | The address people use to reach MediaTrove, e.g. `https://mediatrove.example.com`. Needed behind a reverse proxy so links in emails and Google/OIDC sign-in point to the right place. Put HTTPS in front of it if it's reachable from the internet. |
| `MEDIATROVE_SIGNUPS` | Who can make an account: `invite` (default: only people the admin invites), `open` (anyone who can reach the page) or `closed` (nobody new). The first account can always be made. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Adds "Continue with Google" to the sign-in page. Make an OAuth client at console.cloud.google.com (type Web application) with the redirect address `<MEDIATROVE_URL>/api/auth/callback/google`. |
| `OIDC_DISCOVERY_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_NAME` | Adds a sign-in button for your own login server (Authentik, Pocket ID, Keycloak…). The discovery URL ends in `/.well-known/openid-configuration`; the redirect address is `<MEDIATROVE_URL>/api/auth/callback/oidc`; `OIDC_NAME` is the button's label. |
| `MEDIATROVE_PASSWORD` | From before accounts. If it's set, it's asked for until the first account exists (so an upgraded server can't be claimed by a stranger), then it does nothing. |
| `RPDB_API_KEY` | Rating posters for movies and shows: the poster with IMDb and Rotten Tomatoes scores drawn on it, from [RPDB](https://ratingposterdb.com). Anime shows its community score (MyAnimeList, AniList and others) without a key. Switch both off in Settings → Display. |
| `AUDIBLE_REGION` | Which Audible store to search for audiobooks: us, uk, ca, au, de, fr, it, es, in, jp. Default us. |
| `SIMKL_CLIENT_ID` | For the Simkl import, so the form doesn't ask for it (a free app from simkl.com/settings/developer). |
| `RESEND_API_KEY`, `MEDIATROVE_EMAIL_FROM` | Email through [Resend](https://resend.com) (free tier: 3,000 emails a month): invites and password resets. The sender, e.g. `MediaTrove <mediatrove@example.com>`, must be on a domain you've verified with Resend. Without email, invite links are shown for you to send, and the admin makes password-reset links. |
| `MEDIATROVE_BACKUP_EMAIL_TO` | Also email the admin's weekly backup to this address (needs the two above). `MEDIATROVE_BACKUP_EMAIL_FROM`, the sender's older name, still works. |
| `MEDIATROVE_SECRET_KEY` | The key that encrypts your app logins. Normally created for you in `data/secret.key`; set this (32 bytes, base64) only if you'd rather keep it out of the data folder. |

## Connecting apps

Open **Plugins**, pick your app, and sign in. MediaTrove keeps a session token (encrypted), never
your password. For apps that support it, choose how to keep them in sync:

- **Off:** MediaTrove only reads.
- **Add only** (recommended): your marks are added to the app; nothing there is ever unmarked.
- **Full:** your latest action wins both ways, including unmarks.

Anything already marked in the app comes into MediaTrove first. Turning sync on for an existing
connection shows what it would add before it does anything, with an option to only send new marks.

### Audiobookshelf: connect a basic User account, never Admin or Root

MediaTrove keeps a login token for the account you connect. The plugin only reads, but if your
MediaTrove server or its `data` folder were ever stolen, an Admin or Root token would let someone
change or delete your whole Audiobookshelf server. A **User** account can only see its own progress.
Better safe than sorry: **only connect an account whose type is User.**

Check the type in Audiobookshelf under **Settings → Users**. Then:

- **You listen on a User account:** connect that one. Done.
- **You listen on an Admin account:** sign in as Root (or another Admin), open **Settings → Users**, edit your account,
  set **Account type** to **User**, save, and connect it.
- **You listen on the Root account** (the first account made on the server): Root can't be changed to
  a User, and Audiobookshelf can't move listening progress between accounts. Do this instead:
  1. In Audiobookshelf, make a new **User** account for listening from now on.
  2. Optional, to keep your past listening in MediaTrove: connect the Root account once, wait for the
     first sync to finish (Settings → Connected apps shows it), then press **Disconnect**. MediaTrove
     deletes its Root token but keeps the history it brought in.
  3. Connect the new User account and listen on it from now on. Books you were partway through start
     at the beginning on the new account, so skip ahead in the player (or finish them first).

An Audiobookshelf **API key** works too, as long as it was made for a User account.

## Imports

**Import** page. Trakt, Letterboxd, IMDb and Netflix read the export file each service lets you download
(Netflix: a profile's "Viewing activity" download, or the "Get my info" ZIP, which covers every profile).
MyAnimeList reads a public profile by username. Simkl signs in with a code. Running an import again
only adds what's new, and each import can be undone.

## Backups

**Settings, then Backups:** download everything as one file, or restore from one. A copy of each
person's library is also saved every week in `data/users/<id>/backups` (the last 8 are kept). App
logins aren't in backups: reconnect your apps after restoring. Backing up the whole `data` folder
covers everything, logins and accounts included.

## Accounts and friends

One MediaTrove holds a library per person. The admin (the first account) invites people from
**Settings, then People**: type their email and send them the link (it's emailed for you when email
is set up). The link works once, for 7 days, for that address only. Each person's library, history,
connected apps and backups are their own; nobody, the admin included, sees anyone else's in the app.
They do live on your server, in `data/users/<id>/`.

Everyone signs in with email and password, and can add a passkey (fingerprint, face or screen lock)
and two-factor codes under **Settings, then Account**, where they can also export their data or delete
their account. Google and your own login server are optional extras (see Settings above).

Upgrading from before accounts: your existing library becomes the first account's, so make that
account first. If `MEDIATROVE_PASSWORD` is set, the browser asks for it until then.

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
