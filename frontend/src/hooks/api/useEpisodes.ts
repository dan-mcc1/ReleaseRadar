import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

interface WatchedEpisode {
  season_number: number;
  episode_number: number;
}

interface NextEpisode {
  season_number: number;
  episode_number: number;
  name: string;
  still_path: string | null;
}

export function useEpisodeDetail<T>(
  showId: string | undefined,
  season: string | undefined,
  episode: string | undefined,
) {
  return useQuery<T>({
    queryKey: queryKeys.episodeDetail(showId ?? "", season ?? "", episode ?? ""),
    queryFn: () =>
      queryFetch<T>(`/tv/${showId}/season/${season}/episode/${episode}`),
    enabled: !!showId && !!season && !!episode,
  });
}

export function useWatchedEpisodes(showId: number) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.watchedEpisodes(user?.uid ?? "", showId),
    queryFn: () =>
      queryFetch<WatchedEpisode[]>(`/watched-episode/${showId}`),
    enabled: !!user && showId > 0,
  });
}

export function useNextEpisode(showId: number) {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.nextEpisode(user?.uid ?? "", showId),
    queryFn: () =>
      queryFetch<NextEpisode>(`/watched-episode/${showId}/next`),
    enabled: !!user && showId > 0,
  });
}

export function useNextEpisodesBulk(showIds: number[]) {
  const user = useAuthUser();
  const idsStr = showIds.sort().join(",");
  return useQuery({
    queryKey: queryKeys.nextEpisodesBulk(user?.uid ?? "", idsStr),
    queryFn: () =>
      queryFetch<Record<string, NextEpisode>>(
        `/watched-episode/next/bulk?show_ids=${idsStr}`,
      ),
    enabled: !!user && showIds.length > 0,
  });
}

export function useToggleEpisode() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      showId,
      seasonNumber,
      episodeNumber,
      watched,
    }: {
      showId: number;
      seasonNumber: number;
      episodeNumber: number;
      watched: boolean;
    }) => {
      const method = watched ? "DELETE" : "POST";
      const endpoint = watched
        ? "/watched-episode/remove"
        : "/watched-episode/add";
      await apiFetch(
        `${endpoint}?show_id=${showId}&season_number=${seasonNumber}&episode_number=${episodeNumber}`,
        { method },
      );
    },
    onSuccess: (_, { showId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.watchedEpisodes(user.uid, showId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.nextEpisode(user.uid, showId),
      });
      queryClient.invalidateQueries({
        queryKey: ["nextEpisodes", "bulk", user.uid],
      });
      queryClient.invalidateQueries({
        queryKey: ["watchStatus", user.uid],
      });
    },
  });
}

export function useToggleSeason() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      showId,
      seasonNumber,
      allWatched,
    }: {
      showId: number;
      seasonNumber: number;
      allWatched: boolean;
    }) => {
      const method = allWatched ? "DELETE" : "POST";
      const endpoint = allWatched
        ? "/watched-episode/season/remove"
        : "/watched-episode/season/add";
      await apiFetch(
        `${endpoint}?show_id=${showId}&season_number=${seasonNumber}`,
        { method },
      );
    },
    onSuccess: (_, { showId }) => {
      if (!user) return;
      queryClient.invalidateQueries({
        queryKey: queryKeys.watchedEpisodes(user.uid, showId),
      });
      queryClient.invalidateQueries({
        queryKey: queryKeys.nextEpisode(user.uid, showId),
      });
      queryClient.invalidateQueries({
        queryKey: ["nextEpisodes", "bulk", user.uid],
      });
      queryClient.invalidateQueries({
        queryKey: ["watchStatus", user.uid],
      });
    },
  });
}
