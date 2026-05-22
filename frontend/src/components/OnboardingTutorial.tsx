import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { useUserMe } from "../hooks/api/useUser";
import { useAuthUser } from "../hooks/useAuthUser";
import { apiFetch } from "../utils/apiFetch";
import { queryKeys } from "../hooks/api/queryKeys";

interface Step {
  icon: string;
  title: string;
  description: string;
  cta?: { label: string; path: string };
}

const STEPS: Step[] = [
  {
    icon: "🎬",
    title: "Welcome to ReleaseRadar!",
    description:
      "Your personal hub for tracking every show and movie you love. Let's take a quick tour so you can hit the ground running.",
  },
  {
    icon: "📋",
    title: "Build your lists",
    description:
      "Add anything to your Watchlist to save it for later. When you start watching, move it to Currently Watching. Once you're done, mark it Watched — ReleaseRadar tracks it all.",
    cta: { label: "Go to Watchlist", path: "/watchlist" },
  },
  {
    icon: "📅",
    title: "Never miss an episode",
    description:
      "The Calendar shows every upcoming release for shows you're tracking. See what's airing this week, this month, or further ahead — all in one place.",
    cta: { label: "Open Calendar", path: "/calendar" },
  },
  {
    icon: "🔍",
    title: "Discover what's next",
    description:
      "Browse Trending titles, check the Upcoming page for new releases, or let For You surface recommendations based on what you've already watched.",
    cta: { label: "See what's trending", path: "/trending" },
  },
  {
    icon: "📚",
    title: "Shelves & Stats",
    description:
      "Organize your media into custom Shelves — think 'Weekend Binges' or 'Date Night Movies'. Visit Stats to see your total watch time, top genres, and longest binge sessions.",
    cta: { label: "View my shelves", path: "/shelves" },
  },
  {
    icon: "👥",
    title: "Watch with friends",
    description:
      "Follow friends to see what they're watching in the Activity Feed. Compare lists, share recommendations, and discover new favorites through the people you trust.",
    cta: { label: "View my profile", path: "/profile" },
  },
  {
    icon: "🔔",
    title: "Stay in the loop",
    description:
      "Turn on email notifications in Settings to get a daily digest, season premiere alerts, and streaming availability updates. Upgrade to Premium for advanced features like Binge Planner, detailed stats, and more.",
    cta: { label: "Open Settings", path: "/settings" },
  },
];

export default function OnboardingTutorial() {
  const authUser = useAuthUser();
  const { data: dbUser, isLoading } = useUserMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  async function dismiss() {
    await apiFetch("/user/complete-onboarding", { method: "POST" });
    if (authUser) {
      queryClient.invalidateQueries({ queryKey: queryKeys.userMe(authUser.uid) });
    }
  }

  async function handleCta(path: string) {
    await dismiss();
    navigate(path);
  }

  if (!authUser || isLoading || !dbUser || dbUser.onboarding_completed) return null;

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={dismiss}
      />

      {/* Card */}
      <div className="relative w-full max-w-md bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Progress bar */}
        <div className="h-1 bg-neutral-800">
          <div
            className="h-full bg-violet-500 transition-all duration-300"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>

        <div className="p-6 flex flex-col gap-4">
          {/* Step counter */}
          <p className="text-xs text-neutral-500 font-medium tracking-widest uppercase">
            {step + 1} / {STEPS.length}
          </p>

          {/* Icon */}
          <div className="text-5xl select-none">{current.icon}</div>

          {/* Content */}
          <div className="flex flex-col gap-2">
            <h2 className="text-xl font-bold text-neutral-100">
              {current.title}
            </h2>
            <p className="text-neutral-400 leading-relaxed text-sm">
              {current.description}
            </p>
          </div>

          {/* Dot indicators */}
          <div className="flex gap-1.5 mt-1">
            {STEPS.map((_, i) => (
              <button
                key={i}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all duration-200 ${
                  i === step
                    ? "w-6 bg-violet-500"
                    : "w-1.5 bg-neutral-700 hover:bg-neutral-500"
                }`}
              />
            ))}
          </div>

          {/* Actions */}
          <div className="flex items-center justify-between pt-2">
            <button
              onClick={dismiss}
              className="text-sm text-neutral-500 hover:text-neutral-300 transition-colors"
            >
              Skip tour
            </button>

            <div className="flex gap-2">
              {step > 0 && (
                <button
                  onClick={() => setStep((s) => s - 1)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                >
                  Back
                </button>
              )}

              {current.cta && (
                <button
                  onClick={() => handleCta(current.cta!.path)}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-800 hover:bg-neutral-700 text-neutral-300 transition-colors"
                >
                  {current.cta.label}
                </button>
              )}

              <button
                onClick={() => (isLast ? dismiss() : setStep((s) => s + 1))}
                className="px-4 py-2 rounded-lg text-sm font-bold bg-violet-600 hover:bg-violet-500 text-white transition-colors"
              >
                {isLast ? "Get started" : "Next →"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
