import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";
import { CHECKOUT_ENABLED } from "../config/features";
import {
  useSubscription,
  useCreateCheckoutSession,
} from "../hooks/api/useSubscription";
import { Button, CheckIcon, CloseIcon, PageHeader, SectionHeader } from "../components/ui";

const FREE_FEATURES = [
  { text: "Track up to 30 titles", included: true },
  { text: "Day-of release email digest", included: true },
  { text: "Basic in-app calendar", included: true },
  { text: "Personalized shelves", included: false },
  { text: "Advance notifications (1–14 days before)", included: false },
  { text: "New season & catch-up alerts", included: false },
  { text: "Streaming arrival/departure alerts", included: false },
  { text: "Google Calendar & Outlook sync", included: false },
  { text: "Full personalized recommendations", included: false },
];

const PRO_FEATURES = [
  { text: "Unlimited title tracking", included: true },
  { text: "Day-of release email digest", included: true },
  { text: "Full in-app calendar", included: true },
  { text: "Personalized shelves (Date Night, Horror Queue…)", included: true },
  { text: "Advance notifications (1–14 days before)", included: true },
  { text: "New season & catch-up alerts", included: true },
  { text: "Streaming arrival/departure alerts", included: true },
  { text: "Google Calendar & Outlook sync", included: true },
  { text: "Full personalized recommendations", included: true },
];

const PAID_FAQ = [
  {
    q: "What counts toward the 30-title limit?",
    a: "Items on your Watchlist and Currently Watching lists count. Titles you've already marked as Watched do not.",
  },
  {
    q: "Can I cancel anytime?",
    a: "Yes. You can cancel your subscription at any time from your billing settings. You'll keep Premium access until the end of your current billing period.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — every new Premium subscription starts with a 7-day free trial. No charge until the trial ends.",
  },
  {
    q: "What payment methods are accepted?",
    a: "All major credit and debit cards via Stripe. Your payment details are never stored on our servers.",
  },
];

const BETA_FAQ = [
  {
    q: "Is Release Radar really free right now?",
    a: "Yes. During the beta every feature is unlocked for every account, with no limits and no card required.",
  },
  {
    q: "What happens when the beta ends?",
    a: "Paid plans aren't available yet. We'll tell you before anything changes, and your lists and history stay yours either way.",
  },
  {
    q: "Is there a limit on how many titles I can track?",
    a: "Not during the beta. The 30-title limit shown on the Free plan is planned for after it.",
  },
];

function FeatureIcon({ included }: { included: boolean }) {
  return included ? (
    <CheckIcon className="w-4 h-4 shrink-0 text-neutral-300" />
  ) : (
    <CloseIcon className="w-4 h-4 shrink-0 text-neutral-500" />
  );
}

export default function Pricing() {
  usePageMeta({ title: "Pricing", description: "Release Radar is free during the beta, no card needed. See what is planned for premium." });
  const navigate = useNavigate();
  const { isPremium, isLoading } = useSubscription();
  const checkout = useCreateCheckoutSession();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-12 space-y-12">
      <PageHeader
        title={CHECKOUT_ENABLED ? "Simple, transparent pricing" : "Free during the beta"}
        description={
          CHECKOUT_ENABLED
            ? "Start free, upgrade when you need more. No hidden fees, cancel any time."
            : "Every feature is unlocked for everyone while Release Radar is in beta. The plans below are what we're planning for after it. Nothing is for sale yet."
        }
      />

      {/* Pricing cards; the description above already says they're planned. */}
      <div className="flex flex-col gap-4">
      {!CHECKOUT_ENABLED && <SectionHeader title="Planned pricing" />}
      <div className="grid sm:grid-cols-2 gap-6">
        {/* Free card */}
        <div className="flex flex-col rounded-surface bg-neutral-900 border border-neutral-700 p-6">
          <div className="mb-6">
            <div className="text-label font-semibold text-neutral-400 mb-2">
              Free
            </div>
            <div className="flex items-end gap-1">
              <span className="text-display font-semibold text-white tabular">$0</span>
              <span className="text-neutral-400 mb-1">/ month</span>
            </div>
            <p className="text-label text-neutral-400 mt-2">
              Everything you need to get started.
            </p>
          </div>

          <ul className="space-y-3 flex-1">
            {FREE_FEATURES.map((f) => (
              <li
                key={f.text}
                className={`flex items-start gap-2.5 text-label ${f.included ? "text-neutral-300" : "text-neutral-500"}`}
              >
                <FeatureIcon included={f.included} />
                {f.text}
              </li>
            ))}
          </ul>

          {CHECKOUT_ENABLED && (
            <div className="mt-8">
              {isLoading ? null : isPremium ? (
                <div className="w-full py-3 px-6 rounded-control text-label font-semibold text-center text-neutral-400 border border-neutral-700">
                  Your current plan
                </div>
              ) : (
                <div className="w-full py-3 px-6 rounded-control text-label font-semibold text-center bg-neutral-800 text-neutral-300 border border-neutral-700">
                  Current plan
                </div>
              )}
            </div>
          )}
        </div>

        {/* Premium card */}
        <div className="flex flex-col rounded-surface bg-neutral-900 border border-neutral-500 p-6">
          <div className="mb-6">
            <div className="text-label font-semibold text-neutral-300 mb-2">
              Premium
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <div className="flex items-end gap-1">
                  <span className="text-display font-semibold text-white tabular">$4.99</span>
                  <span className="text-neutral-400 mb-1">/ month</span>
                </div>
              </div>
              <div className="text-label text-neutral-400">
                or <span className="text-white font-semibold">$39.99/year</span>{" "}
                <span className="text-neutral-300 font-medium">(save 33%)</span>
              </div>
            </div>
            <p className="text-label text-neutral-400 mt-2">
              Unlimited tracking and all premium features.
            </p>
          </div>

          <ul className="space-y-3 flex-1">
            {PRO_FEATURES.map((f) => (
              <li
                key={f.text}
                className="flex items-start gap-2.5 text-label text-neutral-200"
              >
                <FeatureIcon included={f.included} />
                {f.text}
              </li>
            ))}
          </ul>

          <div className="mt-8 space-y-3">
            {!CHECKOUT_ENABLED ? (
              <div className="w-full py-3 px-6 rounded-control text-label font-semibold text-center text-neutral-400 border border-neutral-700">
                Not available yet. Included free during the beta.
              </div>
            ) : isLoading ? null : isPremium ? (
              <Button className="w-full" onClick={() => navigate("/billing")}>
                Manage subscription
              </Button>
            ) : (
              <>
                <Button
                  variant="primary"
                  className="w-full"
                  onClick={() => handleUpgrade("yearly")}
                  disabled={checkout.isPending}
                >
                  {checkout.isPending
                    ? "Redirecting…"
                    : "Upgrade yearly — $39.99/yr"}
                </Button>
                <Button
                  className="w-full"
                  onClick={() => handleUpgrade("monthly")}
                  disabled={checkout.isPending}
                >
                  {checkout.isPending
                    ? "Redirecting…"
                    : "Upgrade monthly — $4.99/mo"}
                </Button>
                {checkoutError && (
                  <p className="text-center text-caption text-error-400">
                    {checkoutError}
                  </p>
                )}
                <p className="text-center text-caption text-neutral-400">
                  7-day free trial · Cancel any time
                </p>
              </>
            )}
          </div>
        </div>
      </div>
      </div>

      {/* FAQ */}
      <div className="max-w-2xl mx-auto">
        <SectionHeader title="Frequently asked questions" divider />
        <div className="divide-y divide-neutral-800">
          {(CHECKOUT_ENABLED ? PAID_FAQ : BETA_FAQ).map(({ q, a }) => (
            <div key={q} className="py-4">
              <p className="text-label font-semibold text-neutral-200 mb-1">{q}</p>
              <p className="text-label text-neutral-400">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
