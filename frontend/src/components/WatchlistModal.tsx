// src/pages/Watchlist.tsx
import { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import { firebaseApp } from "../firebase";
import { BASE_IMAGE_URL, API_URL } from "../constants";
import { useNavigate } from "react-router-dom";
import { CalendarData } from "../types/calendar";
import { FaPencilAlt } from "react-icons/fa";
import { Link } from "react-router-dom";
import WatchButton from "./WatchButton";

interface WatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
  calendarData: CalendarData;
  setCalendarData: React.Dispatch<React.SetStateAction<CalendarData>>;
}

export default function WatchlistModal({
  isOpen,
  onClose,
  calendarData,
  setCalendarData,
}: WatchlistModalProps) {
  if (!isOpen) return null;

  const [filter, setFilter] = useState<"all" | "tv" | "movies">("all");
  const navigate = useNavigate();
  const auth = getAuth(firebaseApp);

  const showsToDisplay =
    filter === "all" || filter === "tv" ? calendarData.shows : [];
  const moviesToDisplay =
    filter === "all" || filter === "movies" ? calendarData.movies : [];

  // Remove a show from watchlist
  const handleRemove = async (contentType: "tv" | "movie", id: number) => {
    try {
      // Get the current user's token for authentication
      const token = await auth.currentUser?.getIdToken();
      if (!token) return;

      // Call backend API to remove show
      const res = await fetch(`${API_URL}/watchlist/remove`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          content_type: contentType,
          content_id: id,
        }),
      });

      if (!res.ok) {
        console.error(`Failed to remove show ${id} from watchlist`);
        return;
      }

      // Update local calendar data
      setCalendarData((prev) => ({
        ...prev,
        shows:
          contentType === "tv"
            ? prev.shows.filter((s) => s.show.id !== id)
            : prev.shows,
        movies:
          contentType === "movie"
            ? prev.movies.filter((m) => m.id !== id)
            : prev.movies,
      }));
    } catch (err) {
      console.error("Error removing show:", err);
    }
  };

  const handleAddShows = async () => {
    onClose();
    navigate("/trending");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-neutral-900 border border-neutral-700 w-11/12 md:w-2/3 lg:w-1/2 max-h-[85vh] flex flex-col rounded-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-neutral-700 flex-shrink-0">
          <h2 className="text-xl font-bold text-white">My Watchlist</h2>
          <div className="flex items-center gap-3">
            <button
              onClick={handleAddShows}
              className="rounded-lg bg-primary-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-primary-500 transition-colors"
            >
              + Add
            </button>
            <button
              onClick={onClose}
              className="h-8 w-8 flex items-center justify-center rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-700 transition-colors text-lg font-bold"
            >
              &times;
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className="px-4 sm:px-6 pt-3 pb-2 sm:pt-4 sm:pb-3 flex-shrink-0">
          <div className="inline-flex rounded-lg border border-neutral-600 overflow-hidden">
            {(["all", "tv", "movies"] as const).map((value, idx, arr) => {
              const label =
                value === "all"
                  ? "All"
                  : value === "tv"
                    ? "TV Shows"
                    : "Movies";
              return (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`px-4 py-1.5 text-sm font-medium transition-colors
                    ${filter === value ? "bg-primary-600 text-white" : "bg-neutral-800 text-neutral-300 hover:bg-neutral-700 hover:text-white"}
                    ${idx < arr.length - 1 ? "border-r border-neutral-600" : ""}
                  `}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 px-4 sm:px-6 pb-4 sm:pb-6">
          {showsToDisplay.length === 0 && moviesToDisplay.length === 0 ? (
            <p className="text-neutral-500 italic py-4">
              Your watchlist is empty.
            </p>
          ) : (
            <div className="flex flex-col gap-3">
              {showsToDisplay.map((showWithCal) => {
                const show = showWithCal.show;
                return (
                  <div
                    key={`tv-${show.id}`}
                    className="flex gap-4 items-start p-4 bg-neutral-800 border border-neutral-700 rounded-xl"
                  >
                    {show.poster_path && (
                      <img
                        src={`${BASE_IMAGE_URL}/w342${show.poster_path}`}
                        alt={show.name}
                        className="w-16 h-auto rounded-lg object-cover flex-shrink-0"
                      />
                    )}
                    <div className="flex flex-col flex-1 min-w-0">
                      <div className="flex justify-between items-start gap-2">
                        <Link to={`/tv/${show.id}`} onClick={onClose}>
                          <h3 className="font-semibold text-neutral-100 hover:text-primary-400 transition-colors line-clamp-1">
                            {show.name}
                          </h3>
                        </Link>
                        <button
                          onClick={() => handleRemove("tv", show.id)}
                          className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-neutral-500 hover:text-error-400 hover:bg-neutral-700 transition-colors text-lg leading-none"
                        >
                          &times;
                        </button>
                      </div>
                      <p className="text-neutral-400 text-xs mt-1 line-clamp-2">
                        {show.overview || "No overview available."}
                      </p>
                      <div className="text-neutral-500 text-xs mt-1.5">
                        First aired: {show.first_air_date}
                      </div>
                    </div>
                  </div>
                );
              })}

              {moviesToDisplay.map((movie) => (
                <div
                  key={`movie-${movie.id}`}
                  className="flex gap-4 items-start p-4 bg-neutral-800 border border-neutral-700 rounded-xl"
                >
                  {movie.poster_path && (
                    <img
                      src={`${BASE_IMAGE_URL}/w342${movie.poster_path}`}
                      alt={movie.title}
                      className="w-16 h-auto rounded-lg object-cover flex-shrink-0"
                    />
                  )}
                  <div className="flex flex-col flex-1 min-w-0">
                    <div className="flex justify-between items-start gap-2">
                      <Link to={`/movie/${movie.id}`} onClick={onClose}>
                        <h3 className="font-semibold text-neutral-100 hover:text-primary-400 transition-colors line-clamp-1">
                          {movie.title}
                        </h3>
                      </Link>
                      <button
                        onClick={() => handleRemove("movie", movie.id)}
                        className="flex-shrink-0 h-6 w-6 flex items-center justify-center rounded-md text-neutral-500 hover:text-error-400 hover:bg-neutral-700 transition-colors text-lg leading-none"
                      >
                        &times;
                      </button>
                    </div>
                    <p className="text-neutral-400 text-xs mt-1 line-clamp-2">
                      {movie.overview || "No overview available."}
                    </p>
                    <div className="text-neutral-500 text-xs mt-1.5">
                      Release: {movie.release_date}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
