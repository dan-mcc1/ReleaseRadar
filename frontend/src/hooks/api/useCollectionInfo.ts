import { useQuery } from "@tanstack/react-query";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import type { Collection } from "../../types/calendar";

export function useCollectionInfo(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.collection(id ?? ""),
    queryFn: () => queryFetch<Collection>(`/collections/${id}`),
    enabled: !!id,
  });
}
