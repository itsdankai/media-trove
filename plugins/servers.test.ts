import { describe, expect, it } from "vitest";
import { assertAllowed as mbAllowed, refFrom } from "./_mediabrowser/client.ts";
import { assertReadOnly as kodiReadOnly, refFromKodi } from "./kodi/plugin.ts";
import { assertReadOnly as plexReadOnly, refFromGuids } from "./plex/plugin.ts";

describe("media-server plugins only make the requests they are allowed", () => {
  it("Jellyfin/Emby: reads only, unless pushing; even then only played/unplayed", () => {
    expect(() => mbAllowed("GET", "/Users/abc/Items")).not.toThrow();
    expect(() => mbAllowed("POST", "/Users/abc/PlayedItems/123")).toThrow(/refused/);
    expect(() => mbAllowed("DELETE", "/Users/abc/PlayedItems/123")).toThrow(/refused/);
    expect(() => mbAllowed("POST", "/Users/abc/PlayedItems/123", true)).not.toThrow();
    expect(() => mbAllowed("DELETE", "/Users/abc/PlayedItems/123", true)).not.toThrow();
    expect(() => mbAllowed("DELETE", "/Items/123", true)).toThrow(/refused/);
    expect(() => mbAllowed("POST", "/Items/123", true)).toThrow(/refused/);
  });
  it("Plex", () => {
    expect(() => plexReadOnly("GET", "/library/sections/2/all")).not.toThrow();
    expect(() => plexReadOnly("GET", "/:/scrobble")).toThrow(/read-only/);
    expect(() => plexReadOnly("PUT", "/library/sections/2/all")).toThrow(/read-only/);
  });
  it("Kodi", () => {
    expect(() => kodiReadOnly("VideoLibrary.GetMovies")).not.toThrow();
    expect(() => kodiReadOnly("VideoLibrary.SetMovieDetails")).toThrow(/read-only/);
    expect(() => kodiReadOnly("VideoLibrary.RemoveMovie")).toThrow(/read-only/);
  });
});

describe("ids from each server", () => {
  it("Jellyfin/Emby ProviderIds (either case)", () => {
    expect(
      refFrom("movie", { Name: "The Matrix", ProductionYear: 1999, ProviderIds: { Tmdb: "603", Imdb: "tt0133093" } }),
    ).toMatchObject({ tmdb: 603, imdb: "tt0133093" });
    expect(refFrom("show", { Name: "Severance", ProviderIds: { tvdb: "371980" } })).toMatchObject({ tvdb: 371980 });
  });
  it("Plex guids", () => {
    expect(
      refFromGuids("movie", { title: "The Matrix", Guid: [{ id: "imdb://tt0133093" }, { id: "tmdb://603" }] }),
    ).toMatchObject({ imdb: "tt0133093", tmdb: 603 });
  });
  it("Kodi uniqueid and old imdbnumber", () => {
    expect(
      refFromKodi("movie", { title: "The Matrix", uniqueid: { tmdb: "603" }, imdbnumber: "tt0133093" }),
    ).toMatchObject({ tmdb: 603, imdb: "tt0133093" });
  });
});
