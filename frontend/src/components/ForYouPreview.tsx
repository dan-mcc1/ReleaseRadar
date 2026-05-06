import { Link } from "react-router-dom";
import MediaList from "./MediaList";
import type { Movie, Show } from "../types/calendar";
import { useForYouPreview } from "../hooks/api/useRecommendations";

export default function ForYouPreview() {
  const { data } = useForYouPreview();
  const movies = ((data?.movies ?? []) as Movie[]).slice(0, 4);
  const shows = ((data?.shows ?? []) as Show[]).slice(0, 4);

  if (!movies.length && !shows.length) return null;

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-white">For You</h2>
        <Link to="/for-you" className="text-sm text-primary-400 hover:text-primary-300 transition-colors">
          See all →
        </Link>
      </div>
      <MediaList results={{ movies, shows, people: [] }} paginated />
    </div>
  );
}
