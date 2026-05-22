import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryFetch, checkedFetch } from "./queryFetch";
import { useAuthUser } from "../useAuthUser";

export interface StreamingProvider {
  id: number;
  name: string;
  logo_path: string;
}

export function useAllProviders() {
  return useQuery<StreamingProvider[]>({
    queryKey: ["streaming", "providers"],
    queryFn: ({ signal }) => queryFetch<StreamingProvider[]>("/streaming/providers", { signal }),
    staleTime: 1000 * 60 * 60 * 24, // providers list rarely changes
  });
}

export function useMyStreamingServices() {
  const user = useAuthUser();
  return useQuery<StreamingProvider[]>({
    queryKey: ["streaming", "services"],
    queryFn: ({ signal }) => queryFetch<StreamingProvider[]>("/streaming/services", { signal }),
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });
}

export function useMyProviderIds(): Set<number> {
  const { data } = useMyStreamingServices();
  return new Set((data ?? []).map((p) => p.id));
}


const SERVICES_KEY = ["streaming", "services"];
const OPTIMIZER_KEY = ["streaming", "optimizer"];

let optimizerRefreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleOptimizerRefresh(qc: ReturnType<typeof useQueryClient>) {
  if (optimizerRefreshTimer !== null) return;
  optimizerRefreshTimer = setTimeout(() => {
    optimizerRefreshTimer = null;
    qc.invalidateQueries({ queryKey: OPTIMIZER_KEY });
  }, 500);
}

export function useAddStreamingService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: number) =>
      checkedFetch(`/streaming/services/${providerId}`, { method: "POST" }),
    onMutate: async (providerId) => {
      await qc.cancelQueries({ queryKey: SERVICES_KEY });
      const previous = qc.getQueryData<StreamingProvider[]>(SERVICES_KEY);
      const allProviders = qc.getQueryData<StreamingProvider[]>(["streaming", "providers"]);
      const provider = allProviders?.find((p) => p.id === providerId);
      if (provider) {
        qc.setQueryData<StreamingProvider[]>(SERVICES_KEY, (old) =>
          old ? [...old, provider] : [provider]
        );
      }
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(SERVICES_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SERVICES_KEY });
      scheduleOptimizerRefresh(qc);
    },
  });
}

export interface OptimizerProvider {
  id: number;
  name: string;
  logo_path: string;
  count: number;
  you_have: boolean;
}

export interface OptimizerItem {
  id: number;
  type: "tv" | "movie";
  title: string;
  poster_path: string | null;
  available_on?: { id: number; name: string; logo_path: string }[];
}

export interface OptimizerSuggestion {
  id: number;
  name: string;
  logo_path: string;
  adds_count: number;
  adds_items: OptimizerItem[];
  you_have: boolean;
}

export interface StreamingOptimizerResult {
  total_items: number;
  items_with_streaming: number;
  my_services_coverage: number;
  coverage_by_provider: OptimizerProvider[];
  uncovered_items: OptimizerItem[];
  no_streaming_items: OptimizerItem[];
  suggested_combo: OptimizerSuggestion[];
}

export function useStreamingOptimizer() {
  const user = useAuthUser();
  return useQuery<StreamingOptimizerResult>({
    queryKey: ["streaming", "optimizer"],
    queryFn: ({ signal }) => queryFetch<StreamingOptimizerResult>("/streaming/optimizer", { signal }),
    enabled: !!user,
    staleTime: 1000 * 60 * 5,
  });
}

export function useRemoveStreamingService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (providerId: number) =>
      checkedFetch(`/streaming/services/${providerId}`, { method: "DELETE" }),
    onMutate: async (providerId) => {
      await qc.cancelQueries({ queryKey: SERVICES_KEY });
      const previous = qc.getQueryData<StreamingProvider[]>(SERVICES_KEY);
      qc.setQueryData<StreamingProvider[]>(SERVICES_KEY, (old) =>
        old ? old.filter((p) => p.id !== providerId) : []
      );
      return { previous };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous !== undefined) {
        qc.setQueryData(SERVICES_KEY, ctx.previous);
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: SERVICES_KEY });
      scheduleOptimizerRefresh(qc);
    },
  });
}
