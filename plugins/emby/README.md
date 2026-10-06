# Emby plugin

Reads played and in-progress movies and episodes from Emby.

- **Connect with:** server address, username and password (exchanged once for an access token; the password isn't stored).
- **Read-only:** only POST /Users/AuthenticateByName, GET /Users/{id}/Items, GET /Shows/{id}/Episodes, GET /System/Info/Public. Anything else is refused in code before it is sent. Keeping Emby in sync uses the same code as Jellyfin but stays off until it's been tested on an Emby library with provider ids.
- **How it syncs:** every 3 minutes it compares what the server says is played with last time; new plays become "watched", positions become progress, and anything unplayed again becomes an unmark (applied only if the connection follows unmarks).
- **Matching:** by the TMDB, IMDb or TVDB ids the server attached, or by title and year when it has none.

## What was consulted

Emby's REST API documentation and a throwaway Emby 4.10 test server.

No code was copied from CrossWatch, Yamtrack or any other project.
