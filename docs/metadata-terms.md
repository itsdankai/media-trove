# Where MediaTrove's data comes from, and the terms that apply

Checked 2026-10-06. MediaTrove is free, self-hosted software: each person runs their own copy, and
their copy calls these services with its own keys. Nothing here is resold. If you run MediaTrove to
make money, re-read these terms first: several are free for non-commercial use only.

| Source | Used for | Key | Terms in short |
|---|---|---|---|
| [TMDB](https://www.themoviedb.org) | Movies and shows: details, posters, seasons, ratings, release dates, franchises | Yours (free) | Free for **non-commercial** use; commercial use needs a licence from TMDB. You must show the TMDB logo and the notice *"This product uses the TMDB API but is not endorsed or certified by TMDB."* in an About/Credits area. MediaTrove shows the notice in its sidebar footer; **the logo still needs adding** (see below). |
| Audible catalog (`api.audible.com/1.0/catalog`) | Audiobook details, covers, categories, upcoming releases | None | Audible's public catalog endpoints, used by its own web pages. There are no published terms for third-party use. MediaTrove only reads public product listings, a few at a time. If Audible objects or changes them, audiobook search and the audiobook calendar stop working; tracking still works. |
| [anime-offline-database](https://github.com/manami-project/anime-offline-database) (manami-project) | Anime genres, tags (Shounen, Isekai…) and scores | None | [ODbL-1.0](https://opendatacommons.org/licenses/odbl/1-0/): free to use with credit. Downloaded once a week and used offline; MediaTrove keeps a small index of it in your data folder and doesn't redistribute it. Scores are its average across AniList, MyAnimeList, Kitsu and others. |
| [AniList](https://anilist.co) | Not used | — | Its API terms forbid use "within competing noncomplementary services of the same nature, including anime/manga list/tracker services." So MediaTrove doesn't call it: anime metadata comes from anime-offline-database, and the AniList import was dropped (2026-10-06). AniList ids still appear in the mapping data, which is just ids. |
| MyAnimeList (`animelist/<user>/load.json`) | The MyAnimeList import (a public list by username) | None | The JSON MAL's own list page loads; not MAL's official API (which needs a client ID). Read once per import, for the user's own public list. |
| [Anime-Lists/anime-lists](https://github.com/Anime-Lists/anime-lists) and [Fribb/anime-lists](https://github.com/Fribb/anime-lists) | Mapping anime between AniDB, AniList, MAL, Simkl and TMDB | None | Community mapping lists. Neither repo has a licence file. MediaTrove downloads them at runtime (once a week) and doesn't ship or redistribute them. |
| Cinemeta (`v3-cinemeta.strem.io`) | Episode order for decoding Stremio's watched list | None | Stremio's public metadata add-on, the same one the Stremio apps use. |
| Trakt, Simkl, Letterboxd, IMDb | One-time imports | Simkl: your own free app ID | MediaTrove reads the export file the user downloads (Trakt, Letterboxd, IMDb) or calls Simkl's API with the user's own sign-in. |

## Still to do before v0.1.0

1. **TMDB logo: done.** TMDB's official logo (its "Alt Short" SVG, bundled) sits above the notice in the
   sidebar footer, smaller than MediaTrove's own branding.
2. **AniList: resolved.** Anime metadata comes from anime-offline-database (scores matched AniList's
   within 0.2 on the builder's anime), and the AniList import was dropped. The MyAnimeList import's
   fallback for unmapped MAL ids now uses the dataset offline instead of AniList's API.
3. **Credits: done.** The README lists every source; the app's footer shows TMDB (logo + notice) and
   anime-offline-database (ODbL).
4. **Freshness.** anime-offline-database's last release was 2026-07-04 (it had been weekly). Anime newer
   than its latest release get TMDB's genres and rating until it updates.
