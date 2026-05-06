// frontend/src/pages/LandingPage.tsx
import { Link, Navigate } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser, useAuthLoading } from "../hooks/useAuthUser";
import TrendingSection from "../components/landing/TrendingSection";
import ComingSoonSection from "../components/landing/ComingSoonSection";
import BrowseGenresSection from "../components/landing/BrowseGenresSection";

export default function LandingPage() {
  usePageTitle();
  const user = useAuthUser();
  const authLoading = useAuthLoading();

  if (authLoading) return null;
  if (user) return <Navigate to="/calendar" replace />;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16">
      <div className="mb-10 text-center py-8">
        <h1 className="text-4xl font-bold text-white mb-3">Track What You Watch</h1>
        <p className="text-neutral-400 mb-6 max-w-md mx-auto">
          Keep up with your favourite shows and movies. Log what you've watched, build your watchlist, and never miss a release.
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
