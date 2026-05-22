import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useSubscription,
  useCreateCheckoutSession,
} from "../hooks/api/useSubscription";

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

function CheckIcon({ included }: { included: boolean }) {
  if (included) {
    return (
      <svg
        className="w-4 h-4 shrink-0 text-amber-400"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    );
  }
  return (
    <svg
      className="w-4 h-4 shrink-0 text-neutral-600"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

export default function Pricing() {
  usePageTitle("Pricing");
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
      {/* Hero */}
      <div className="text-center space-y-4">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/15 border border-amber-400/30 mb-2">
          <svg
            className="w-8 h-8 text-amber-400"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M2.5 7.5L5 14h14l2.5-6.5L17 10l-5-6-5 6-4.5-2.5zm2.5 8h14v2H5v-2z" />
          </svg>
        </div>
        <h1 className="text-4xl font-bold text-white">
          Simple, transparent pricing
        </h1>
        <p className="text-neutral-400 text-lg max-w-xl mx-auto">
          Start free, upgrade when you need more. No hidden fees, cancel any
          time.
        </p>
      </div>

      {/* Pricing cards */}
      <div className="grid sm:grid-cols-2 gap-6">
        {/* Free card */}
        <div className="flex flex-col rounded-2xl bg-neutral-900 border border-neutral-700 p-6">
          <div className="mb-6">
            <div className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-2">
              Free
            </div>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-white">$0</span>
              <span className="text-neutral-500 mb-1">/ month</span>
            </div>
            <p className="text-sm text-neutral-400 mt-2">
              Everything you need to get started.
            </p>
          </div>

          <ul className="space-y-3 flex-1">
            {FREE_FEATURES.map((f) => (
              <li
                key={f.text}
                className={`flex items-start gap-2.5 text-sm ${f.included ? "text-neutral-300" : "text-neutral-600"}`}
              >
                <CheckIcon included={f.included} />
                {f.text}
              </li>
            ))}
          </ul>

          <div className="mt-8">
            {isLoading ? null : isPremium ? (
              <div className="w-full py-3 px-6 rounded-xl text-sm font-semibold text-center text-neutral-500 border border-neutral-700">
                Your current plan
              </div>
            ) : (
              <div className="w-full py-3 px-6 rounded-xl text-sm font-semibold text-center bg-neutral-800 text-neutral-300 border border-neutral-700">
                Current plan
              </div>
            )}
          </div>
        </div>

        {/* Premium card */}
        <div className="flex flex-col rounded-2xl bg-amber-950/20 border border-amber-500/30 p-6 relative overflow-hidden">
          <div className="absolute top-0 right-0 bg-amber-400/10 border-b border-l border-amber-400/30 px-3 py-1.5 rounded-bl-xl">
            <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
              Premium
            </span>
          </div>

          <div className="mb-6">
            <div className="text-xs font-semibold uppercase tracking-widest text-amber-500/70 mb-2">
              Premium
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <div className="flex items-end gap-1">
                  <span className="text-4xl font-bold text-white">$4.99</span>
                  <span className="text-neutral-400 mb-1">/ month</span>
                </div>
              </div>
              <div className="text-sm text-neutral-400">
                or <span className="text-white font-semibold">$39.99/year</span>{" "}
                <span className="text-emerald-400 font-medium">(save 33%)</span>
              </div>
            </div>
            <p className="text-sm text-neutral-400 mt-2">
              Unlimited tracking and all premium features.
            </p>
          </div>

          <ul className="space-y-3 flex-1">
            {PRO_FEATURES.map((f) => (
              <li
                key={f.text}
                className="flex items-start gap-2.5 text-sm text-neutral-200"
              >
                <CheckIcon included={f.included} />
                {f.text}
              </li>
            ))}
          </ul>

          <div className="mt-8 space-y-3">
            {isLoading ? null : isPremium ? (
              <button
                onClick={() => navigate("/billing")}
                className="w-full py-3 px-6 rounded-xl font-semibold text-sm bg-amber-500/20 text-amber-400 border border-amber-500/30 hover:bg-amber-500/30 transition-colors"
              >
                Manage subscription
              </button>
            ) : (
              <>
                {/* <button
                  onClick={() => handleUpgrade("yearly")}
                  disabled={checkout.isPending}
                  className="w-full py-3 px-6 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400 text-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {checkout.isPending
                    ? "Redirecting…"
                    : "Upgrade yearly — $39.99/yr"}
                </button>
                <button
                  onClick={() => handleUpgrade("monthly")}
                  disabled={checkout.isPending}
                  className="w-full py-3 px-6 rounded-xl font-semibold text-sm bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {checkout.isPending
                    ? "Redirecting…"
                    : "Upgrade monthly — $4.99/mo"}
                </button>
                {checkoutError && (
                  <p className="text-center text-xs text-red-400">
                    {checkoutError}
                  </p>
                )}
                <p className="text-center text-xs text-neutral-500">
                  7-day free trial · Cancel any time
                </p> */}
                <button className="w-full py-3 px-6 rounded-xl font-semibold text-sm bg-amber-500 text-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                  Currently in Beta, upgrading will be available soon
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {/* FAQ */}
      <div className="space-y-4 max-w-2xl mx-auto">
        <h2 className="text-xl font-bold text-white text-center">
          Frequently asked questions
        </h2>
        <div className="space-y-3">
          {[
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
          ].map(({ q, a }) => (
            <div
              key={q}
              className="rounded-xl bg-neutral-900 border border-neutral-800 p-4"
            >
              <p className="text-sm font-semibold text-neutral-200 mb-1">{q}</p>
              <p className="text-sm text-neutral-400">{a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
