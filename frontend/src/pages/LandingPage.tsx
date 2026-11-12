// frontend/src/pages/LandingPage.tsx
import { Navigate } from "react-router-dom";
import { usePageMeta } from "../hooks/usePageMeta";
import { useAuthUser } from "../hooks/useAuthUser";
import TrendingSection from "../components/landing/TrendingSection";
import ComingSoonSection from "../components/landing/ComingSoonSection";
import BrowseGenresSection from "../components/landing/BrowseGenresSection";
import ReleasePreview from "../components/landing/ReleasePreview";
import WhySection from "../components/landing/WhySection";
import { ButtonLink } from "../components/ui";

export default function LandingPage() {
  usePageMeta({
    description:
      "Track the shows and movies you follow. Release Radar builds your release calendar and alerts from them and keeps your lists up to date, down to the episode. Free during the beta.",
  });
  const user = useAuthUser();

  // Signed-in visitors go to their calendar as soon as auth knows who they
  // are. Until then the page renders as signed out instead of blank.
  if (user) return <Navigate to="/calendar" replace />;

  return (
    <div className="w-full px-6 sm:px-10 pt-10 pb-16 flex flex-col gap-16">
      <section
        aria-labelledby="landing-title"
        className="grid items-start gap-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] max-w-7xl"
      >
        <div className="lg:pt-8">
          <h1
            id="landing-title"
            className="text-display font-semibold text-neutral-50 [text-wrap:balance] max-w-xl"
          >
            Never miss a new episode or a release you care about.
          </h1>
          <p className="mt-4 max-w-lg text-body text-neutral-300">
            Track the shows and movies you follow. Release Radar builds your calendar from them,
            tells you when they air, and keeps your lists up to date as you watch, down to the
            episode.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <ButtonLink to="/signIn?mode=register" variant="primary">
              Create a free account
            </ButtonLink>
            <ButtonLink to="/browse-genres" variant="ghost">
              Browse titles
            </ButtonLink>
          </div>
          <p className="mt-4 text-label text-neutral-300">
            Free during the beta: every feature unlocked, no card needed.
          </p>
          <p className="mt-1 text-caption text-neutral-400">
            The calendar shows original air dates only, not reruns.
          </p>
        </div>
        <ReleasePreview />
      </section>

      <WhySection />
      <TrendingSection />
      <ComingSoonSection />
      <BrowseGenresSection />
    </div>
  );
}
