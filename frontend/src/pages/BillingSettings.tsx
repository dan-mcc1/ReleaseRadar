import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { CHECKOUT_ENABLED } from "../config/features";
import {
  useSubscription,
  useBillingStatus,
  useCreatePortalSession,
  useCancelStripeSubscription,
} from "../hooks/api/useSubscription";
import { useCreateCheckoutSession } from "../hooks/api/useSubscription";
import { Button, CheckIcon, ChevronLeftIcon, PageHeader, SectionHeader } from "../components/ui";

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
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
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
      <PageHeader
        title="Billing & Subscription"
        description="Manage your Release Radar plan."
      />

      {/* Current plan */}
      <section>
        <div className="pb-5 border-b border-neutral-800 flex items-center justify-between">
          <div>
            <p className="text-caption text-neutral-400 mb-1">
              Current plan
            </p>
            <div className="flex items-center gap-2">
              <span className="text-title font-semibold text-white">
                {TIER_LABELS[tier] ?? tier}
              </span>
              {isPremium && !isAdmin && (
                <span className="text-caption font-semibold border border-neutral-600 text-neutral-300 rounded-full px-2 py-0.5">
                  Premium
                </span>
              )}
              {isAdmin && (
                <span className="text-caption font-semibold bg-highlight-400/15 text-highlight-400 border border-highlight-400/30 rounded-full px-2 py-0.5">
                  Admin
                </span>
              )}
            </div>
          </div>

          {isPremium ? (
            <div className="flex items-center gap-2 text-label text-neutral-400">
              <CheckIcon className="w-4 h-4 text-primary-400" />
              {cancelAtPeriodEnd ? "Cancels at period end" : "Active"}
            </div>
          ) : (
            <span className="text-caption text-neutral-400 border border-neutral-700 rounded-full px-3 py-1">
              Free tier
            </span>
          )}
        </div>

        <div className="pt-5">
          {isPremium ? (
            <div className="space-y-4">
              {!billingLoading && periodEnd && (
                <p className="text-label text-neutral-400">
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
                  <Button
                    onClick={handleManage}
                    disabled={openPortal.isPending}
                  >
                    {openPortal.isPending ? "Opening…" : "Manage subscription"}
                  </Button>
                </div>
              )}
              {portalError && (
                <p className="text-caption text-error-400">{portalError}</p>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              <p className="text-label text-neutral-400">
                You're on the Free plan. Upgrade to Premium to unlock all
                features.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {PRO_FEATURES.map((f) => (
                  <div
                    key={f}
                    className="flex items-center gap-2 text-label text-neutral-300"
                  >
                    <CheckIcon className="w-3.5 h-3.5 shrink-0 text-neutral-400" />
                    {f}
                  </div>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 pt-1">
                {CHECKOUT_ENABLED ? (
                  <>
                <Button
                  variant="primary"
                  onClick={() => handleUpgrade("yearly")}
                  disabled={checkout.isPending}
                >
                  {checkout.isPending ? "Redirecting…" : "Upgrade yearly — $39.99/yr"}
                </Button>
                <Button
                  onClick={() => handleUpgrade("monthly")}
                  disabled={checkout.isPending}
                >
                  {checkout.isPending ? "Redirecting…" : "Upgrade monthly — $4.99/mo"}
                </Button>
                  </>
                ) : (
                  <Button disabled>
                    Currently in Beta
                  </Button>
                )}
              </div>
              {checkoutError && (
                <p className="text-caption text-error-400">{checkoutError}</p>
              )}
              <p className="text-caption text-neutral-400">
                7-day free trial · Cancel any time
              </p>

              {/* <button
                onClick={() => navigate("/pricing")}
                className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
              >
                See full pricing details → design-ok (commented-out code)
              </button> */}
            </div>
          )}
        </div>
      </section>

      {/* Tracking usage (free only) */}
      {!isPremium && (
        <section className="pt-6 border-t border-neutral-800 space-y-2">
          <SectionHeader title="Tracking limit" />
          <p className="text-label text-neutral-400">
            Free accounts can track up to{" "}
            <span className="text-white font-semibold">30 titles</span> across
            Watchlist and Currently Watching. Upgrade to Premium for unlimited
            tracking.
          </p>
        </section>
      )}

      {/* Cancel subscription (premium non-admin, not already canceling) */}
      {isPremium && !isAdmin && !cancelAtPeriodEnd && (
        <section className="pt-6 border-t border-neutral-800 space-y-3">
          <SectionHeader title="Cancel subscription" />

          {!confirmingCancel ? (
            <>
              <p className="text-label text-neutral-400">
                You'll keep Premium access until the end of your current billing
                period, then your account will revert to Free.
              </p>
              <Button variant="danger" onClick={() => setConfirmingCancel(true)}>
                Cancel subscription
              </Button>
            </>
          ) : (
            <>
              <p className="text-label text-neutral-300 font-medium">
                Are you sure?
              </p>
              <p className="text-label text-neutral-400">
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
                <Button
                  variant="danger"
                  onClick={handleCancel}
                  disabled={cancelMutation.isPending}
                >
                  {cancelMutation.isPending
                    ? "Cancelling…"
                    : "Yes, cancel my subscription"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setConfirmingCancel(false)}
                  disabled={cancelMutation.isPending}
                >
                  Keep Premium
                </Button>
              </div>
            </>
          )}
        </section>
      )}

      <div className="text-center">
        <Button
          variant="ghost"
          icon={<ChevronLeftIcon />}
          onClick={() => navigate("/settings")}
        >
          Back to Settings
        </Button>
      </div>
    </div>
  );
}
