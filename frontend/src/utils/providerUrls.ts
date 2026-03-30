// Maps TMDB provider_id to the provider's website URL
// TMDB provider IDs: https://developer.themoviedb.org/reference/watch-provider-list
const PROVIDER_URLS: Record<number, string> = {
  // 2: "https://www.apple.com/itunes/",           // Apple iTunes
  2: "https://tv.apple.com/",                   // Apple TV
  3: "https://play.google.com/store/movies",    // Google Play Movies
  7: "https://www.vudu.com",                    // Vudu
  8: "https://www.netflix.com",                 // Netflix
  9: "https://www.primevideo.com",              // Amazon Prime Video
  10: "https://www.primevideo.com",        // Amazon Video
  11: "https://mubi.com",                       // MUBI
  15: "https://www.hulu.com",                   // Hulu
  37: "https://www.sho.com",                    // Showtime
  43: "https://www.starz.com",                  // Starz
  68: "https://www.microsoft.com/en-us/store/movies-and-tv", // Microsoft Store
  73: "https://tubitv.com",                     // Tubi TV
  78: "https://www.amc.com",                    // AMC on Demand
  143: "https://www.peacocktv.com",             // Peacock Premium
  175: "https://www.netflix.com",               // Netflix Kids
  188: "https://www.youtube.com/movies",        // YouTube Movies
  192: "https://www.youtube.com",               // YouTube
  233: "https://www.sling.com",                 // Sling TV
  257: "https://www.fubo.tv",                   // fuboTV
  283: "https://www.crunchyroll.com",           // Crunchyroll
  300: "https://pluto.tv",                      // Pluto TV
  337: "https://www.disneyplus.com",            // Disney+
  350: "https://tv.apple.com",                  // Apple TV+
  358: "https://www.youtube.com/premium",       // YouTube Premium
  372: "https://www.directv.com",               // DIRECTV
  384: "https://www.max.com",                   // Max
  386: "https://www.peacocktv.com",             // Peacock
  387: "https://www.peacocktv.com",               // Peacock Premium
  444: "https://www.plex.tv",                   // Plex
  526: "https://www.amcplus.com",               // AMC+
  531: "https://www.paramountplus.com",         // Paramount+
  551: "https://www.paramountplus.com",         // Paramount+ with Showtime
  584: "https://www.plex.tv",                   // Plex Player
  613: "https://www.peacocktv.com",             // Peacock Premium Plus
  1285: "https://www.hbomax.com",                // HBO Max
  1796: "https://www.netflix.com",              // Netflix basic with ads
  1899: "https://www.hbomax.com",               // HBO Max
  2528: "https://tv.youtube.com",               // YoutubeTV
};

export function getProviderUrl(providerId: number): string | undefined {
  return PROVIDER_URLS[providerId];
}

// Returns the hostname (e.g. "www.netflix.com") for use as a deduplication key.
// Falls back to the provider ID string for unmapped providers so they don't collapse together.
export function getProviderDedupeKey(providerId: number): string {
  const url = getProviderUrl(providerId);
  if (!url) return String(providerId);
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}
