// frontend/src/pages/LandingPage.tsx
import { Link, Navigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser, useAuthLoading } from "../hooks/useAuthUser";
import TrendingSection from "../components/landing/TrendingSection";
import ComingSoonSection from "../components/landing/ComingSoonSection";
import BrowseGenresSection from "../components/landing/BrowseGenresSection";

const PRIMARY = "#10b981";

function RadarSVG() {
  return (
    <svg
      viewBox="0 0 600 600"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: "fixed",
        inset: 0,
        width: "100%",
        height: "100%",
        opacity: 0.35,
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {[60, 110, 165, 220, 278, 338, 400].map((r) => (
        <circle
          key={r}
          cx="300"
          cy="300"
          r={r}
          stroke={PRIMARY}
          strokeWidth="0.7"
          fill="none"
          opacity={0.5 - r / 1400}
        />
      ))}
      <line x1="0" y1="300" x2="600" y2="300" stroke={PRIMARY} opacity="0.1" />
      <line x1="300" y1="0" x2="300" y2="600" stroke={PRIMARY} opacity="0.1" />
      <line x1="0" y1="0" x2="600" y2="600" stroke={PRIMARY} opacity="0.06" />
      <line x1="600" y1="0" x2="0" y2="600" stroke={PRIMARY} opacity="0.06" />
      <defs>
        <linearGradient id="lp-sweep-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={PRIMARY} stopOpacity="0" />
          <stop offset="100%" stopColor={PRIMARY} stopOpacity="0.4" />
        </linearGradient>
      </defs>
      <path
        d="M 300 300 L 680 300 A 400 400 0 0 0 530 20 Z"
        fill="url(#lp-sweep-grad)"
      />
      {(
        [
          [430, 220],
          [375, 385],
          [240, 178],
          [182, 358],
          [460, 378],
          [205, 480],
          [410, 132],
          [320, 460],
          [150, 250],
        ] as [number, number][]
      ).map(([x, y], i) => (
        <g key={i}>
          <circle cx={x} cy={y} r="5" fill={`oklch(0.62 0.13 ${i * 38 + 90})`} />
          <circle cx={x} cy={y} r="10" fill={PRIMARY} opacity="0.1" />
        </g>
      ))}
    </svg>
  );
}

export default function LandingPage() {
  usePageTitle();
  const user = useAuthUser();
  const authLoading = useAuthLoading();

  if (authLoading) return null;
  if (user) return <Navigate to="/calendar" replace />;

  return (
    <div className="relative w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16" style={{ zIndex: 1 }}>
      <RadarSVG />
      <div className="mb-10 text-center py-8">
        <h1 className="text-4xl font-bold text-white mb-3">
          Track What You Watch
        </h1>
        <p className="text-neutral-400 mb-6 max-w-md mx-auto">
          Keep up with your favourite shows and movies. Log what you've watched,
          build your watchlist, and never miss a release.
        </p>
        <p className="text-xs text-neutral-600 mb-6 max-w-sm mx-auto">
          Calendar shows initial air dates only — reruns are not included.
        </p>
        <Link
          to="/signIn"
          className="inline-block bg-primary-600 hover:bg-primary-500 text-white font-semibold px-6 py-2.5 rounded-lg transition-colors"
        >
          Sign in to get started
        </Link>
      </div>
      <div className="flex flex-col gap-14">
        <TrendingSection />
        <ComingSoonSection />
        <BrowseGenresSection />
      </div>
    </div>
  );
}
