export const queryKeys = {
  // Search & discovery
  search: (query: string) => ["search", query] as const,
  searchDebounce: (query: string) => ["search", "debounce", query] as const,
  trending: (type: "movie" | "tv", page: number) => ["trending", type, page] as const,
  trendingMulti: () => ["trending", "multi"] as const,
  upcoming: (type: "movie" | "tv", page: number) => ["upcoming", type, page] as const,
  comingSoon: () => ["upcoming", "comingSoon"] as const,
  airingToday: () => ["airingToday"] as const,
  nowPlaying: () => ["nowPlaying"] as const,
  popularMulti: () => ["popular", "multi"] as const,
  topRatedMulti: () => ["topRated", "multi"] as const,
  genres: () => ["genres"] as const,
  genreResults: (type: string, genreId: number, page: number) =>
    ["genres", type, genreId, page] as const,

  // Media detail
  person: (id: string) => ["person", id] as const,
  collection: (id: string) => ["collection", id] as const,
  mediaDetail: (type: "movie" | "tv", id: string) => ["media", type, id] as const,
  mediaDetailFull: (type: "movie" | "tv", id: string) => ["media", type, id, "full"] as const,
  aggregateRating: (type: string, id: string) => ["reviews", "aggregate", type, id] as const,
  externalScores: (imdbId: string) => ["reviews", "externalScores", imdbId] as const,

  // Lists
  watchlist: (uid: string) => ["watchlist", uid] as const,
  watched: (uid: string) => ["watched", uid] as const,
  currentlyWatching: (uid: string) => ["currentlyWatching", uid] as const,
  favorites: (uid: string) => ["favorites", uid] as const,
  favoriteStatus: (uid: string, type: string, id: number) =>
    ["favorites", "status", uid, type, id] as const,

  // Watch status
  watchStatus: (uid: string, type: string, id: number) =>
    ["watchStatus", uid, type, id] as const,
  bulkWatchStatus: (uid: string, key: string) =>
    ["watchStatus", "bulk", uid, key] as const,

  // Friends & social
  friends: (uid: string) => ["friends", uid] as const,
  friendRequestsIncoming: (uid: string) => ["friends", "incoming", uid] as const,
  friendRequestsOutgoing: (uid: string) => ["friends", "outgoing", uid] as const,
  followers: (uid: string) => ["friends", "followers", uid] as const,
  friendSuggestions: (uid: string) => ["friends", "suggestions", uid] as const,
  friendsContentActivity: (uid: string, type: string, id: number) =>
    ["friends", "content", uid, type, id] as const,
  friendProfile: (username: string) => ["friends", "profile", username] as const,

  // User
  userMe: (uid: string) => ["user", "me", uid] as const,
  userStats: (uid: string) => ["user", "stats", uid] as const,
  watchTimeStats: (uid: string, year: number | null) => ["user", "watchTime", uid, year] as const,
  profileSummary: (uid: string) => ["user", "profileSummary", uid] as const,
  usernameAvailable: (username: string) => ["user", "checkUsername", username] as const,

  // Recommendations
  forYou: (uid: string, mode: string) => ["recommendations", "forYou", uid, mode] as const,
  recommendationsInbox: (uid: string) => ["recommendations", "inbox", uid] as const,
  unreadRecCount: (uid: string) => ["recommendations", "unreadCount", uid] as const,

  // Reviews
  reviews: (type: string, id: number) => ["reviews", type, id] as const,

  // Episodes
  episodeDetail: (showId: string, season: string, episode: string) =>
    ["episode", showId, season, episode] as const,
  watchedEpisodes: (uid: string, showId: number) =>
    ["watchedEpisodes", uid, showId] as const,
  nextEpisode: (uid: string, showId: number) =>
    ["nextEpisode", uid, showId] as const,
  nextEpisodesBulk: (uid: string, showIds: string) =>
    ["nextEpisodes", "bulk", uid, showIds] as const,

  // Activity
  myActivity: (uid: string) => ["activity", "mine", uid] as const,
  friendsActivity: (uid: string) => ["activity", "friends", uid] as const,

  // Notifications / settings
  notificationPrefs: (uid: string) => ["notifications", "prefs", uid] as const,

  // Navbar
  navCounts: (uid: string) => ["nav", "counts", uid] as const,
  navAvatar: (uid: string) => ["nav", "avatar", uid] as const,

  // Calendar (already exists via calendarQueryKey, keeping for reference)
  calendar: (uid: string) => ["calendar", uid] as const,

  // Calendar sync
  icalToken: (uid: string) => ["ical", "token", uid] as const,

  // Box office
  boxOffice: (mode: string, year: number, month: number) =>
    ["boxOffice", mode, year, month] as const,
  boxOfficeAllTime: (page: number) =>
    ["boxOffice", "all-time", page] as const,

  // Shelves
  shelves: (uid: string) => ["shelves", uid] as const,
  shelfItems: (uid: string, shelfId: number) => ["shelves", uid, shelfId, "items"] as const,
  shelfCalendar: (uid: string, shelfId: number) => ["shelves", uid, shelfId, "calendar"] as const,
  itemShelves: (uid: string, contentType: string, contentId: number) =>
    ["shelves", "item", uid, contentType, contentId] as const,

  // News
  news: (category: string, page: number, q: string) =>
    ["news", category, page, q] as const,

  // Admin
  adminStats: () => ["admin", "stats"] as const,
  adminReports: (status: string) => ["admin", "reports", status] as const,
  adminUsers: (search: string, skip: number) => ["admin", "users", search, skip] as const,

  // Moderation
  myBlocks: (uid: string) => ["moderation", "blocks", uid] as const,

  // Billing
  billingStatus: (uid: string) => ["billing", "status", uid] as const,
} as const;
