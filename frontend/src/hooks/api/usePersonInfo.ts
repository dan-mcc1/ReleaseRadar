import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";

export function usePersonInfo<T = unknown>(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.person(id ?? ""),
    queryFn: () => queryFetch<T>(`/person/${id}/info`),
    enabled: !!id,
  });
}
