import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";

export interface BoxOfficeMovie {
  rank: number;
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  revenue: number;
  budget: number;
  vote_average: number;
  runtime: number;
  genres: { id: number; name: string }[];
}

export function useBoxOffice(
  mode: "yearly" | "monthly",
  year: number,
  month: number,
  limit: number,
) {
  return useQuery({
    queryKey: queryKeys.boxOffice(mode, year, month),
    queryFn: () => {
      const params =
        mode === "yearly"
          ? `year=${year}&limit=${limit}`
          : `year=${year}&month=${month}&limit=${limit}`;
      return queryFetch<BoxOfficeMovie[]>(`/box-office/${mode}?${params}`);
    },
  });
}
