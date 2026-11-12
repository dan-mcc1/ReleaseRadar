// src/components/WatchlistModal.tsx
import { useState } from "react";
import { BASE_IMAGE_URL } from "../constants";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { calendarQueryKey } from "../hooks/useCalendarData";
import { useAuthUser } from "../hooks/useAuthUser";
import { useRemoveFromList } from "../hooks/api/useLists";
import type { CalendarData } from "../types/calendar";
import { Button, CloseIcon, IconButton, Modal } from "./ui";

interface WatchlistModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function WatchlistModal({
  isOpen,
  onClose,
}: WatchlistModalProps) {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  const removeFromList = useRemoveFromList();
  const [filter, setFilter] = useState<"all" | "tv" | "movies">("all");
  const navigate = useNavigate();

  const { data } = useQuery<CalendarData>({
    queryKey: calendarQueryKey(user?.uid ?? ""),
    enabled: !!user,
  });

  const showsToDisplay =
    filter === "all" || filter === "tv" ? (data?.shows ?? []) : [];
  const moviesToDisplay =
    filter === "all" || filter === "movies" ? (data?.movies ?? []) : [];

  const handleRemove = (contentType: "tv" | "movie", id: number) => {
    removeFromList.mutate(
      { list: "watchlist", contentType, contentId: id },
      {
        onSuccess: () => {
          if (user) {
            queryClient.invalidateQueries({ queryKey: calendarQueryKey(user.uid) });
          }
        },
      },
    );
  };

  const handleAddShows = async () => {
    onClose();
    navigate("/trending");
  };

  return (
    <Modal open={isOpen} onClose={onClose} title="My Watchlist" size="xl">
      <div className="flex items-center justify-between gap-3 mb-4">
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
        <Button variant="primary" size="sm" onClick={handleAddShows}>
          + Add
        </Button>
      </div>

      <div>
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
                        <IconButton
                          label={`Remove ${show.name} from watchlist`}
                          icon={<CloseIcon className="w-4 h-4" />}
                          size="sm"
                          onClick={() => handleRemove("tv", show.id)}
                          className="shrink-0"
                        />
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
                      <IconButton
                        label={`Remove ${movie.title} from watchlist`}
                        icon={<CloseIcon className="w-4 h-4" />}
                        size="sm"
                        onClick={() => handleRemove("movie", movie.id)}
                        className="shrink-0"
                      />
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
    </Modal>
  );
}
