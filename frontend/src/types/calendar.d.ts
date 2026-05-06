export type CalendarData = {
  shows: ShowWithCalendar[];
  movies: Movie[];
}

export type Show = {
  id: number;
  backdrop_path: string;
  logo_path: string;
  first_air_date: string;
  genres: Genre[];
  homepage: string;
  in_production: boolean;
  last_air_date: string;
  name: string;
  networks: number[];
  number_of_episodes: number;
  number_of_seasons: number;
  overview: string;
  poster_path: string;
  seasons: Season[];
  status: string;
  tagline: string;
  tracking_count: number;
  type: string;
  providers: Provider;

  air_time?: string | null;
  air_timezone?: string | null;
  bg_color?: string;
  popularity?: number;
  vote_average?: number;
  user_rating?: number | null;
  sort_key?: number;
  watchlist_id?: number;
}

export type Season = {
  air_date: string;
  episode_count: number;
  id: number;
  name: string;
  overview: string;
  poster_path: string;
  season_number: number;
  vote_average: number
}

export type ShowWithCalendar = {
  show: Show;
  episodes: Episode[];
}

export type Episode = {
  air_date: string;
  episode_number: number;
  episode_type: string;
  id: number;
  name: string;
  overview: string;
  runtime: number;
  season_number: number;
  show_id: number;
  still_path: string | null;
  vote_average: number;
  vote_count: number;
  is_watched: boolean;

  showData: Show;
}

export type Movie = {
  id: number;
  imdb_id: string;
  backdrop_path: string;
  logo_path: string;
  budget: number;
  genres: Genre[];
  homepage: string;
  overview: string;
  tagline: string;
  poster_path: string;
  release_date: string;
  revenue: number;
  status: string;
  runtime: number;
  title: string;
  tracking_count: number;
  providers?: Provider;

  bg_color?: string;
  popularity?: number;
  vote_average?: number;
  is_watched: boolean;
  user_rating?: number | null;
  sort_key?: number;
  watchlist_id?: number;
}

export type Genre = {
  id: number;
  name: string;
}

export type Provider = {
  link: string;
  flatrate?: WatchProvider[];
  free: WatchProvider[];
  buy: WatchProvider[];
  rent: WatchProvider[];
}

export type WatchProvider = {
  logo_path: string;
  provider_id: number;
  provider_name: string;
  display_priority: number
}

export type Person = {
  id: number;
  name: string;
  profile_path: string;
  known_for_department: string;
  popularity?: number
}

export type Collection = {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  parts: Movie[];
}

export type CollectionResult = {
  id: number;
  name: string;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  popularity?: number;
}