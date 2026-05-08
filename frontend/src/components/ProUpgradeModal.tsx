import { useNavigate } from "react-router-dom";

export type UpgradeFeature = "shelves" | "tracking_limit" | "general";

interface FeatureCopy {
  title: string;
  subtitle: React.ReactNode;
}

const FEATURE_COPY: Record<UpgradeFeature, FeatureCopy> = {
  shelves: {
    title: "Unlock Release Radar Premium",
    subtitle: (
      <>
        Shelves are a Premium feature. Upgrade to create personalized lists like{" "}
        <span className="text-neutral-300 italic">"Date Night"</span>,{" "}
        <span className="text-neutral-300 italic">"Horror Queue"</span>, and
        more.
      </>
    ),
  },
  tracking_limit: {
    title: "You've hit your tracking limit",
    subtitle:
      "Free accounts can track up to 30 titles across your Watchlist and Currently Watching. Upgrade to Premium for unlimited tracking.",
  },
  general: {
    title: "Unlock Release Radar Premium",
    subtitle:
      "Upgrade to Premium to get unlimited tracking, personalized shelves, advance notifications, calendar sync, and more.",
  },
};

const FREE_FEATURES = [
  "Track up to 30 items",
  "Day-of release email notifications",
  "Basic in-app calendar",
];

const FREE_MISSING = [
  "Personalized lists (Shelves)",
  "Advance notifications",
  "External calendar sync",
];

const PRO_FEATURES = [
  "Unlimited item tracking",
  "Personalized lists — Date Night, Horror Queue, etc.",
  "New season & catch-up alerts (7 & 30 days before)",
  "Streaming arrival/departure alerts",
  "Watch Time Wrapped — shareable yearly stats",
  "Binge Planner — time remaining & pace estimates",
  "Rewatch tracking with ratings & notes",
  "Google Calendar, Outlook & iOS Calendar sync",
  "Full personalized recommendations",
];

interface Props {
  onClose: () => void;
  feature?: UpgradeFeature;
  /** When true, dismissing the modal also navigates back (for full-page gates like Shelves). */
  navigateBackOnClose?: boolean;
}

export default function ProUpgradeModal({
  onClose,
  feature = "general",
  navigateBackOnClose = false,
}: Props) {
  const navigate = useNavigate();
  const { title, subtitle } = FEATURE_COPY[feature];

  function handleDismiss() {
    onClose();
    if (navigateBackOnClose) navigate(-1);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={handleDismiss}
    >
      <div
        className="relative w-full max-w-2xl rounded-2xl bg-neutral-900 border border-neutral-700 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="relative px-6 pt-8 pb-6 text-center bg-gradient-to-b from-amber-950/60 to-neutral-900 rounded-t-2xl border-b border-amber-500/20">
          <button
            onClick={handleDismiss}
            className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-300 transition-colors"
            aria-label="Close"
          >
            <svg
              className="w-5 h-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>

          <div className="inline-flex items-center justify-center w-14 h-14 rounded-full bg-amber-500/15 border border-amber-400/30 mb-4">
            <svg
              className="w-7 h-7 text-amber-400"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M2.5 7.5L5 14h14l2.5-6.5L17 10l-5-6-5 6-4.5-2.5zm2.5 8h14v2H5v-2z" />
            </svg>
          </div>

          <h2 className="text-2xl font-bold text-white mb-1">{title}</h2>
          <p className="text-neutral-400 text-sm">{subtitle}</p>

          <div className="flex items-center justify-center gap-6 mt-5">
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">$4.99</div>
              <div className="text-xs text-neutral-500">per month</div>
            </div>
            <div className="text-neutral-600 text-lg font-light">or</div>
            <div className="text-center">
              <div className="text-2xl font-bold text-amber-400">$39.99</div>
              <div className="text-xs text-neutral-500">
                per year{" "}
                <span className="text-emerald-400 font-medium">(save 33%)</span>
              </div>
            </div>
          </div>
        </div>

        {/* Feature comparison */}
        <div className="grid sm:grid-cols-2 gap-px bg-neutral-700/50 mx-6 mt-6 rounded-xl overflow-hidden">
          {/* Free column */}
          <div className="bg-neutral-800/80 p-5">
            <div className="text-xs font-semibold uppercase tracking-widest text-neutral-500 mb-4">
              Free
            </div>
            <ul className="space-y-2.5">
              {FREE_FEATURES.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm text-neutral-300"
                >
                  <svg
                    className="w-4 h-4 mt-0.5 shrink-0 text-neutral-500"
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
                </li>
              ))}
              {FREE_MISSING.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm text-neutral-600"
                >
                  <svg
                    className="w-4 h-4 mt-0.5 shrink-0 text-neutral-700"
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
                  {f}
                </li>
              ))}
            </ul>
          </div>

          {/* Premium column */}
          <div className="bg-amber-950/20 p-5 relative">
            <div className="absolute top-3 right-3">
              <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-400/15 text-amber-400 border border-amber-400/30 rounded-full px-2 py-0.5">
                Premium
              </span>
            </div>
            <div className="text-xs font-semibold uppercase tracking-widest text-amber-500/70 mb-4">
              Premium
            </div>
            <ul className="space-y-2.5">
              {PRO_FEATURES.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm text-neutral-200"
                >
                  <svg
                    className="w-4 h-4 mt-0.5 shrink-0 text-amber-400"
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
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* CTAs */}
        <div className="px-6 py-6 flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={() => {
              onClose();
              navigate("/pricing");
            }}
            className="w-full sm:flex-1 py-3 px-6 rounded-xl font-semibold text-sm bg-amber-500 hover:bg-amber-400 text-black transition-colors"
          >
            See pricing
          </button>
          <button
            onClick={handleDismiss}
            className="w-full sm:w-auto py-3 px-5 rounded-xl text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Maybe Later
          </button>
        </div>
      </div>
    </div>
  );
}
