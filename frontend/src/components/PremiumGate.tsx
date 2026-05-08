import { useState } from "react";
import { useSubscription } from "../hooks/api/useSubscription";
import ProUpgradeModal from "./ProUpgradeModal";

interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

export default function PremiumGate({ children, fallback }: Props) {
  const { isPremium, isLoading } = useSubscription();
  const [showModal, setShowModal] = useState(false);

  if (isLoading) return null;

  if (!isPremium) {
    return (
      <>
        {fallback ?? (
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-1.5 text-sm text-amber-400 hover:text-amber-300 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.5 7.5L5 14h14l2.5-6.5L17 10l-5-6-5 6-4.5-2.5zm2.5 8h14v2H5v-2z" />
            </svg>
            Premium feature
          </button>
        )}
        {showModal && <ProUpgradeModal onClose={() => setShowModal(false)} />}
      </>
    );
  }

  return <>{children}</>;
}
