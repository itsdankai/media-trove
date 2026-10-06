# Kodi plugin

Reads played and in-progress movies and episodes from Kodi.

- **Connect with:** Kodi web interface address, username and password. Kodi has no tokens, so the password is kept, encrypted.
- **Read-only:** only JSON-RPC methods JSONRPC.Ping, VideoLibrary.GetMovies, GetTVShows, GetEpisodes. Anything else is refused in code before it is sent.
- **How it syncs:** every 3 minutes it compares what the server says is played with last time; new plays become "watched", positions become progress, and anything unplayed again becomes an unmark (applied only if the connection follows unmarks).
- **Matching:** by the TMDB, IMDb or TVDB ids the server attached, or by title and year when it has none.

## What was consulted

The Kodi JSON-RPC wiki (v13) and a throwaway headless Kodi 21.3 test instance.

No code was copied from CrossWatch, Yamtrack or any other project.
