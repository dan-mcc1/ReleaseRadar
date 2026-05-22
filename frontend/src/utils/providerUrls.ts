// Maps TMDB provider_id to the provider's website URL
// TMDB provider IDs: https://developer.themoviedb.org/reference/watch-provider-list
const PROVIDER_URLS: Record<number, string> = {
  2: "https://tv.apple.com/",                              // Apple TV Store
  3: "https://play.google.com/store/movies",               // Google Play Movies
  7: "https://www.vudu.com",                               // Fandango At Home (Vudu)
  8: "https://www.netflix.com",                            // Netflix
  9: "https://www.primevideo.com",                         // Amazon Prime Video
  11: "https://mubi.com",                                  // MUBI
  15: "https://www.hulu.com",                              // Hulu
  34: "https://www.mgmplus.com",                           // MGM Plus
  37: "https://www.sho.com",                               // Showtime
  43: "https://www.starz.com",                             // Starz
  68: "https://www.microsoft.com/en-us/store/movies-and-tv", // Microsoft Store
  73: "https://tubitv.com",                                // Tubi TV
  78: "https://www.amc.com",                               // AMC on Demand
  80: "https://www.amc.com",                               // AMC
  151: "https://www.britbox.com",                          // BritBox
  191: "https://www.kanopy.com",                           // Kanopy
  192: "https://www.youtube.com",                          // YouTube
  233: "https://www.sling.com",                            // Sling TV
  257: "https://www.fubo.tv",                              // fuboTV
  283: "https://www.crunchyroll.com",                      // Crunchyroll
  289: "https://www.max.com",                              // Cinemax (now Max)
  300: "https://pluto.tv",                                 // Pluto TV
  322: "https://www.usanetwork.com",                       // USA Network
  337: "https://www.disneyplus.com",                       // Disney+
  350: "https://tv.apple.com",                             // Apple TV+
  363: "https://www.tntdrama.com",                         // TNT
  372: "https://www.directv.com",                          // DIRECTV
  384: "https://www.max.com",                              // Max
  386: "https://www.peacocktv.com",                        // Peacock
  444: "https://www.plex.tv",                              // Plex (alternate ID)
  486: "https://www.spectrum.net",                         // Spectrum On Demand
  506: "https://www.tbs.com",                              // TBS
  507: "https://www.trutv.com",                            // tru TV
  526: "https://www.amcplus.com",                          // AMC+
  531: "https://www.paramountplus.com",                    // Paramount+ (alternate ID)
  538: "https://www.plex.tv",                              // Plex
  584: "https://www.plex.tv",                              // Plex Player (alternate ID)
  1956: "https://www.angel.com",                           // Angel Studios
  2383: "https://www.philo.com",                           // Philo
  2528: "https://tv.youtube.com",                          // YouTube TV
  2616: "https://www.paramountplus.com",                   // Paramount+ (canonical)
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
