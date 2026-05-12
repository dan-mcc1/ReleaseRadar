import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { driver } from "driver.js";
import "driver.js/dist/driver.css";
import "./SpotlightTour.css";
import { useUserMe } from "../hooks/api/useUser";
import { useAuthUser } from "../hooks/useAuthUser";
import { apiFetch } from "../utils/apiFetch";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "../hooks/api/queryKeys";

const SESSION_KEY = "rr_tour_group";
const LB_IMPORTING_KEY = "rr_lb_importing";

interface TourGroup {
  path: string;
  hash?: string;
  steps: { element?: string; title: string; description: string }[];
}

const TOUR_GROUPS: TourGroup[] = [
  {
    path: "/calendar",
    steps: [
      {
        title: "👋 Welcome to ReleaseRadar!",
        description:
          "Let's take a quick tour of all the features. Click Next to continue, or close to explore on your own.",
      },
      {
        element: "[data-tour='currently-watching']",
        title: "📺 Currently Watching",
        description:
          "Shows you're actively watching appear here. Pick up right where you left off.",
      },
      {
        element: "[data-tour='calendar-view']",
        title: "📅 Episode Calendar",
        description:
          "See every upcoming episode for shows you're tracking. Switch between week and month view.",
      },
    ],
  },
  {
    path: "/watchlist",
    steps: [
      {
        element: "[data-tour='watchlist-header']",
        title: "📋 Your Watchlist",
        description:
          "Save anything you want to watch later. Sort, filter by type, or drag to re-order your queue.",
      },
    ],
  },
  {
    path: "/trending",
    steps: [
      {
        element: "[data-tour='trending-header']",
        title: "🔥 Discover Content",
        description:
          "Browse trending titles, check what's upcoming, or let For You surface personalized recommendations.",
      },
    ],
  },
  {
    path: "/box-office",
    steps: [
      {
        element: "[data-tour='box-office-header']",
        title: "🎬 Box Office",
        description:
          "Track top-grossing movies by year or month. See budgets, revenue, and profit at a glance.",
      },
    ],
  },
  {
    path: "/news",
    steps: [
      {
        element: "[data-tour='news-header']",
        title: "📰 Entertainment News",
        description:
          "Stay up to date with the latest headlines — cancellations, renewals, casting news, and more.",
      },
    ],
  },
  {
    path: "/settings",
    hash: "#notifications",
    steps: [
      {
        element: "#notifications",
        title: "🔔 Notifications",
        description:
          "Turn on email notifications to get a daily digest, season premiere alerts, and streaming availability updates.",
      },
    ],
  },
];

export default function SpotlightTour() {
  const authUser = useAuthUser();
  const { data: dbUser, isLoading } = useUserMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const navigatingRef = useRef(false);
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const [lbDismissing, setLbDismissing] = useState(false);

  async function endTour() {
    sessionStorage.removeItem(SESSION_KEY);
    await apiFetch("/user/complete-onboarding", { method: "POST" });
    if (authUser) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.userMe(authUser.uid),
      });
    }
  }

  async function dismissLbPrompt() {
    await apiFetch("/user/dismiss-letterboxd-prompt", { method: "POST" });
    if (authUser) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.userMe(authUser.uid),
      });
    }
  }

  async function handleLbImportNow() {
    setLbDismissing(true);
    sessionStorage.setItem(LB_IMPORTING_KEY, "1");
    await dismissLbPrompt();
    navigate("/import");
  }

  async function handleLbSkip() {
    setLbDismissing(true);
    await dismissLbPrompt();
  }

  // Destroy driver on unmount
  useEffect(() => {
    return () => {
      driverRef.current?.destroy();
    };
  }, []);

  useEffect(() => {
    if (!authUser || isLoading || !dbUser) return;
    if (dbUser.onboarding_completed) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }

    // Wait for Letterboxd prompt to be dismissed before starting the tour
    if (!dbUser.letterboxd_prompted) return;

    // If user is actively on /import from the Letterboxd prompt, don't interfere.
    // When they navigate away the flag is cleared and the tour resumes.
    const lbImporting = sessionStorage.getItem(LB_IMPORTING_KEY);
    if (lbImporting) {
      if (location.pathname === "/import") return;
      sessionStorage.removeItem(LB_IMPORTING_KEY);
    }

    // Determine which group to show
    const stored = sessionStorage.getItem(SESSION_KEY);
    if (stored === null) {
      sessionStorage.setItem(SESSION_KEY, "0");
    }
    const groupIndex = parseInt(sessionStorage.getItem(SESSION_KEY) ?? "0", 10);

    if (isNaN(groupIndex) || groupIndex >= TOUR_GROUPS.length) {
      endTour();
      return;
    }

    const group = TOUR_GROUPS[groupIndex];

    // Navigate to the correct page if needed
    if (location.pathname !== group.path) {
      navigatingRef.current = true;
      navigate(group.path + (group.hash ?? ""));
      return;
    }

    navigatingRef.current = false;
    const isLastGroup = groupIndex === TOUR_GROUPS.length - 1;

    // Wait one tick for any page content to mount
    const timer = setTimeout(() => {
      driverRef.current?.destroy();

      const driverInst = driver({
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.65,
        stagePadding: 8,
        allowClose: true,
        showProgress: true,
        popoverClass: "rr-tour-popover",
        nextBtnText: "Next →",
        prevBtnText: "← Back",
        doneBtnText: isLastGroup ? "Finish ✓" : "Next →",
        onNextClick: () => {
          const current = driverRef.current?.getActiveIndex() ?? 0;
          if (current < group.steps.length - 1) {
            driverRef.current?.moveNext();
          } else {
            const nextGroupIdx = groupIndex + 1;
            navigatingRef.current = true;
            driverRef.current?.destroy();
            if (nextGroupIdx >= TOUR_GROUPS.length) {
              endTour();
            } else {
              sessionStorage.setItem(SESSION_KEY, String(nextGroupIdx));
              const nextGroup = TOUR_GROUPS[nextGroupIdx];
              navigate(nextGroup.path + (nextGroup.hash ?? ""));
            }
          }
        },
        onPrevClick: () => {
          driverRef.current?.movePrevious();
        },
        onDestroyStarted: () => {
          // Only fires on user-initiated close (X button / Escape / overlay click)
          // NOT fired when we call destroy() ourselves
          if (!navigatingRef.current) {
            endTour();
          }
          driverRef.current?.destroy();
        },
        steps: group.steps.map((step) => ({
          element: step.element,
          popover: { title: step.title, description: step.description },
        })),
      });

      driverRef.current = driverInst;
      driverInst.drive();
    }, 350);

    return () => {
      clearTimeout(timer);
    };
  }, [location.pathname, dbUser?.onboarding_completed, dbUser?.letterboxd_prompted, isLoading]);

  // Show the Letterboxd import prompt before the tour begins
  if (!isLoading && authUser && dbUser && !dbUser.onboarding_completed && !dbUser.letterboxd_prompted) {
    return (
      <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/75 backdrop-blur-sm">
        <div className="bg-neutral-900 border border-neutral-700 rounded-2xl p-8 max-w-sm w-full mx-4 shadow-2xl">
          <div className="flex flex-col items-center text-center gap-5">
            {/* Icon */}
            <div className="w-16 h-16 rounded-2xl bg-[#00b020]/10 border border-[#00b020]/25 flex items-center justify-center">
              <svg className="w-8 h-8 text-[#00b020]" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm-3.5 6.5a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm7 0a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM12 17c-2.21 0-4-1.343-4-3h8c0 1.657-1.79 3-4 3z"/>
              </svg>
            </div>

            {/* Text */}
            <div>
              <h2 className="text-lg font-bold text-white">Import from Letterboxd</h2>
              <p className="text-sm text-neutral-400 mt-2 leading-relaxed">
                Already tracking films on Letterboxd? Import your watch history and watchlist in seconds — ratings and watch dates included.
              </p>
            </div>

            {/* Buttons */}
            <div className="flex flex-col gap-2.5 w-full">
              <button
                onClick={handleLbImportNow}
                disabled={lbDismissing}
                className="w-full py-2.5 px-4 rounded-xl bg-[#00b020] hover:bg-[#00961b] disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
              >
                Import from Letterboxd
              </button>
              <button
                onClick={handleLbSkip}
                disabled={lbDismissing}
                className="w-full py-2.5 px-4 rounded-xl bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed text-neutral-300 font-medium text-sm transition-colors"
              >
                Skip for now
              </button>
            </div>

            <p className="text-xs text-neutral-600">
              You can always import later from Settings → Account
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
