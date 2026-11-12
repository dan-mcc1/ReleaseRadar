import { useNavigate } from "react-router-dom";
import { Button, CheckIcon, CloseIcon, Modal, SectionHeader } from "./ui";

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
        <span className="text-neutral-300">"Date Night"</span>,{" "}
        <span className="text-neutral-300">"Horror Queue"</span>, and
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
}

export default function ProUpgradeModal({
  onClose,
  feature = "general",
}: Props) {
  const navigate = useNavigate();
  const { title, subtitle } = FEATURE_COPY[feature];

  function handleDismiss() {
    onClose();
  }

  return (
    <Modal
      open
      onClose={handleDismiss}
      title={title}
      description={subtitle}
      size="xl"
      footer={
        <>
          <Button variant="ghost" onClick={handleDismiss}>
            Maybe Later
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              navigate("/pricing");
            }}
          >
            See pricing
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-6 pb-6 border-b border-neutral-800">
        <div>
          <div className="text-heading font-semibold text-white tabular">$4.99</div>
          <div className="text-caption text-neutral-400">per month</div>
        </div>
        <div className="text-neutral-500 text-title font-light">or</div>
        <div>
          <div className="text-heading font-semibold text-white tabular">$39.99</div>
          <div className="text-caption text-neutral-400">
            per year{" "}
            <span className="text-neutral-300 font-medium">(save 33%)</span>
          </div>
        </div>
      </div>

      {/* Feature comparison */}
      <div className="grid sm:grid-cols-2 gap-6 mt-6">
        {/* Free column */}
        <div>
          <SectionHeader title="Free" as="h3" divider className="mb-4" />
          <ul className="space-y-2.5">
            {FREE_FEATURES.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 text-label text-neutral-300"
              >
                <CheckIcon className="w-4 h-4 mt-0.5 shrink-0 text-neutral-500" />
                {f}
              </li>
            ))}
            {FREE_MISSING.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 text-label text-neutral-500"
              >
                <CloseIcon className="w-4 h-4 mt-0.5 shrink-0 text-neutral-700" />
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Premium column */}
        <div>
          <SectionHeader title="Premium" as="h3" divider className="mb-4" />
          <ul className="space-y-2.5">
            {PRO_FEATURES.map((f) => (
              <li
                key={f}
                className="flex items-start gap-2 text-label text-neutral-200"
              >
                <CheckIcon className="w-4 h-4 mt-0.5 shrink-0 text-neutral-300" />
                {f}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </Modal>
  );
}
