// frontend/src/types/media.ts

export interface ExternalScores {
  imdb?: string;
  rotten_tomatoes?: string;
  metacritic?: string;
}

export interface AggregateRating {
  average: number | null;
  count: number;
}

export interface MediaCredits {
  cast: {
    id: number;
    name: string;
    profile_path: string;
    character: string;
  }[];
}

export interface MediaExternalIds {
  imdb_id: string;
  tvdb_id: string;
  wikidata_id: string;
  facebook_id: string;
  instagram_id: string;
  twitter_id: string;
}

export interface MediaVideo {
  id: string;
  key: string;
  site: string;
  type: string;
  official: boolean;
}
