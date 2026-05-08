import { useEffect, useRef } from "react";
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

interface TourGroup {
  path: string;
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

  async function endTour() {
    sessionStorage.removeItem(SESSION_KEY);
    await apiFetch("/user/complete-onboarding", { method: "POST" });
    if (authUser) {
      queryClient.invalidateQueries({
        queryKey: queryKeys.userMe(authUser.uid),
      });
    }
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
      navigate(group.path);
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
              navigate(TOUR_GROUPS[nextGroupIdx].path);
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
  }, [location.pathname, dbUser?.onboarding_completed, isLoading]);

  return null;
}
