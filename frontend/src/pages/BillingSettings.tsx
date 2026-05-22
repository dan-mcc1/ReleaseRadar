import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useSubscription,
  useBillingStatus,
  useCreatePortalSession,
  useCancelStripeSubscription,
} from "../hooks/api/useSubscription";
import { useCreateCheckoutSession } from "../hooks/api/useSubscription";

const TIER_LABELS: Record<string, string> = {
  free: "Free",
  premium: "Premium",
  admin: "Admin",
};

const PRO_FEATURES = [
  "Unlimited title tracking",
  "Personalized shelves",
  "Advance notifications (1–14 days before release)",
  "New season & catch-up alerts",
  "Streaming arrival/departure alerts",
  "Google Calendar & Outlook sync",
  "Full personalized recommendations",
];

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BillingSettings() {
  usePageTitle("Billing");
  const navigate = useNavigate();
  const { tier, isPremium, isAdmin, isLoading } = useSubscription();
  const { data: billing, isLoading: billingLoading } = useBillingStatus();
  const openPortal = useCreatePortalSession();
  const cancelMutation = useCancelStripeSubscription();
  const checkout = useCreateCheckoutSession();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [portalError, setPortalError] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <div className="w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  async function handleManage() {
    setPortalError(null);
    try {
      const { url } = await openPortal.mutateAsync();
      window.location.href = url;
    } catch (err) {
      setPortalError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    }
  }

  async function handleCancel() {
    try {
      await cancelMutation.mutateAsync();
      setConfirmingCancel(false);
    } catch (err) {
      alert(
        err instanceof Error
          ? err.message
          : "Failed to cancel subscription. Please try again.",
      );
    }
  }

  async function handleUpgrade(interval: "monthly" | "yearly") {
    setCheckoutError(null);
    try {
      const { url } = await checkout.mutateAsync(interval);
      window.location.href = url;
    } catch (err) {
      setCheckoutError(
        err instanceof Error ? err.message : "Something went wrong",
      );
    }
  }

  const cancelAtPeriodEnd = billing?.cancel_at_period_end ?? false;
  const periodEnd = billing?.current_period_end;

  return (
    <div className="w-full max-w-2xl mx-auto px-4 sm:px-6 py-10 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-neutral-100">
          Billing & Subscription
        </h1>
        <p className="text-sm text-neutral-400 mt-1">
          Manage your Release Radar plan.
        </p>
      </div>

      {/* Current plan */}
      <div className="rounded-2xl bg-neutral-900 border border-neutral-700 overflow-hidden">
        <div className="px-6 py-5 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-neutral-500 font-semibold mb-1">
              Current plan
            </p>
            <div className="flex items-center gap-2">
              <span className="text-xl font-bold text-white">
                {TIER_LABELS[tier] ?? tier}
              </span>
              {isPremium && !isAdmin && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 border border-amber-400/30 rounded-full px-2 py-0.5">
                  Premium
                </span>
              )}
              {isAdmin && (
                <span className="text-[10px] font-bold uppercase tracking-wider bg-purple-400/15 text-purple-400 border border-purple-400/30 rounded-full px-2 py-0.5">
                  Admin
                </span>
              )}
            </div>
          </div>

          {isPremium ? (
            <div className="flex items-center gap-2 text-sm text-neutral-400">
              <svg
                className="w-4 h-4 text-emerald-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              {cancelAtPeriodEnd ? "Cancels at period end" : "Active"}
            </div>
          ) : (
            <span className="text-xs text-neutral-500 bg-neutral-800 border border-neutral-700 rounded-full px-3 py-1">
              Free tier
            </span>
          )}
        </div>

        <div className="px-6 py-5">
          {isPremium ? (
            <div className="space-y-4">
              {!billingLoading && periodEnd && (
                <p className="text-sm text-neutral-400">
                  {cancelAtPeriodEnd ? (
                    <>
                      Your subscription is canceled and access ends on{" "}
                      <span className="text-neutral-200 font-medium">
                        {formatDate(periodEnd)}
                      </span>
                      .
                    </>
                  ) : (
                    <>
                      Next billing date:{" "}
                      <span className="text-neutral-200 font-medium">
                        {formatDate(periodEnd)}
                      </span>
                      .
                    </>
                  )}
                </p>
              )}

              {!isAdmin && (
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleManage}
                    disabled={openPortal.isPending}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {openPortal.isPending ? "Opening…" : "Manage subscription"}
                  </button>
                </div>
              )}
              {portalError && (
                <p className="text-xs text-red-400">{portalError}</p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-sm text-neutral-400">
                You're on the Free plan. Upgrade to Premium to unlock all
                features.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PRO_FEATURES.map((f) => (
                  <div
                    key={f}
                    className="flex items-center gap-2 text-sm text-neutral-300"
                  >
                    <svg
                      className="w-3.5 h-3.5 shrink-0 text-amber-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2.5}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    {f}
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                {/* <button
                  onClick={() => handleUpgrade("yearly")}
                  disabled={checkout.isPending}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-amber-500 hover:bg-amber-400 text-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {checkout.isPending ? "Redirecting…" : "Upgrade yearly — $39.99/yr"}
                </button>
                <button
                  onClick={() => handleUpgrade("monthly")}
                  disabled={checkout.isPending}
                  className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {checkout.isPending ? "Redirecting…" : "Upgrade monthly — $4.99/mo"}
                </button> */}
                <button className="px-5 py-2.5 rounded-xl text-sm font-semibold bg-amber-500 text-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                  Currently in Beta
                </button>
              </div>
              {checkoutError && (
                <p className="text-xs text-red-400">{checkoutError}</p>
              )}
              <p className="text-xs text-neutral-500">
                7-day free trial · Cancel any time
              </p>

              {/* <button
                onClick={() => navigate("/pricing")}
                className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                See full pricing details →
              </button> */}
            </div>
          )}
        </div>
      </div>

      {/* Tracking usage (free only) */}
      {!isPremium && (
        <div className="rounded-2xl bg-neutral-900 border border-neutral-700 px-6 py-5 space-y-2">
          <p className="text-xs uppercase tracking-widest text-neutral-500 font-semibold">
            Tracking limit
          </p>
          <p className="text-sm text-neutral-400">
            Free accounts can track up to{" "}
            <span className="text-white font-semibold">30 titles</span> across
            Watchlist and Currently Watching. Upgrade to Premium for unlimited
            tracking.
          </p>
        </div>
      )}

      {/* Cancel subscription (premium non-admin, not already canceling) */}
      {isPremium && !isAdmin && !cancelAtPeriodEnd && (
        <div className="rounded-2xl bg-neutral-900 border border-neutral-700 px-6 py-5 space-y-3">
          <p className="text-xs uppercase tracking-widest text-neutral-500 font-semibold">
            Cancel subscription
          </p>

          {!confirmingCancel ? (
            <>
              <p className="text-sm text-neutral-400">
                You'll keep Premium access until the end of your current billing
                period, then your account will revert to Free.
              </p>
              <button
                onClick={() => setConfirmingCancel(true)}
                className="px-4 py-2 rounded-xl text-sm font-semibold border border-neutral-700 text-neutral-400 hover:border-red-500/50 hover:text-red-400 transition-colors"
              >
                Cancel subscription
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-neutral-300 font-medium">
                Are you sure?
              </p>
              <p className="text-sm text-neutral-400">
                Your subscription won't renew. You'll keep Premium access until{" "}
                {periodEnd ? (
                  <span className="text-neutral-200 font-medium">
                    {formatDate(periodEnd)}
                  </span>
                ) : (
                  "the end of your billing period"
                )}
                .
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleCancel}
                  disabled={cancelMutation.isPending}
                  className="px-4 py-2 rounded-xl text-sm font-semibold bg-red-600 hover:bg-red-500 text-white disabled:opacity-50 transition-colors"
                >
                  {cancelMutation.isPending
                    ? "Cancelling…"
                    : "Yes, cancel my subscription"}
                </button>
                <button
                  onClick={() => setConfirmingCancel(false)}
                  disabled={cancelMutation.isPending}
                  className="px-4 py-2 rounded-xl text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
                >
                  Keep Premium
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="text-center">
        <button
          onClick={() => navigate("/settings")}
          className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          ← Back to Settings
        </button>
      </div>
    </div>
  );
}
