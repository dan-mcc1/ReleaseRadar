import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useUserMe } from "./useUser";
import { queryKeys } from "./queryKeys";
import { queryFetch } from "./queryFetch";
import { apiFetch } from "../../utils/apiFetch";
import { useAuthUser } from "../useAuthUser";

export class TrackingLimitError extends Error {
  readonly code = "tracking_limit_reached";
  readonly limit: number;
  readonly current: number;

  constructor(limit: number, current: number) {
    super("Free accounts can track up to 30 titles.");
    this.limit = limit;
    this.current = current;
  }
}

export class PremiumRequiredError extends Error {
  readonly code = "premium_required";
  constructor() {
    super("This feature requires a Premium subscription.");
  }
}

export function useSubscription() {
  const { data: user, isLoading } = useUserMe();

  const tier = user?.subscription_tier ?? "free";
  const isPremium = tier !== "free";
  const isAdmin = tier === "admin";

  return { tier, isPremium, isAdmin, isLoading };
}

export interface BillingStatus {
  tier: string;
  status: string | null;
  source: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

export function useBillingStatus() {
  const user = useAuthUser();
  return useQuery({
    queryKey: queryKeys.billingStatus(user?.uid ?? ""),
    queryFn: () => queryFetch<BillingStatus>("/billing/status"),
    enabled: !!user,
  });
}

export function useCreateCheckoutSession() {
  return useMutation({
    mutationFn: async (interval: "monthly" | "yearly") => {
      const res = await apiFetch("/billing/create-checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interval }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? "Failed to start checkout");
      }
      return res.json() as Promise<{ url: string }>;
    },
  });
}

export function useCreatePortalSession() {
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/billing/create-portal-session", {
        method: "POST",
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? "Failed to open billing portal");
      }
      return res.json() as Promise<{ url: string }>;
    },
  });
}

export function useCancelStripeSubscription() {
  const user = useAuthUser();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/billing/cancel", { method: "POST" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.detail ?? "Failed to cancel subscription");
      }
      return res.json();
    },
    onSuccess: () => {
      if (user) {
        queryClient.invalidateQueries({ queryKey: queryKeys.billingStatus(user.uid) });
        queryClient.invalidateQueries({ queryKey: queryKeys.userMe(user.uid) });
      }
    },
  });
}
