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
import SetupFlow from "./onboarding/SetupFlow";

const SESSION_KEY = "rr_tour_group";
const LB_IMPORTING_KEY = "rr_lb_importing";

interface TourGroup {
  path: string;
  /** Query string the page must have, e.g. "?tab=currently_watching". */
  search?: string;
  hash?: string;
  steps: { element?: string; title: string; description: string }[];
}

// Pre-computed at module level so they're stable references
const GROUP_OFFSETS: number[] = [];
const TOUR_GROUPS: TourGroup[] = [
  {
    path: "/calendar",
    steps: [
      {
        title: "Welcome to Release Radar",
        description:
          "A quick look at the places you'll use most. Click Next to continue, or close to explore on your own.",
      },
      {
        element: "[data-tour='continue-watching']",
        title: "Continue Watching",
        description:
          "Shows you're in the middle of, with the next episode to watch. Pick up right where you left off.",
      },
      {
        element: "[data-tour='calendar-episode-list']",
        title: "Your calendar",
        description:
          "Everything airing for the titles you track. This panel shows today, or any day you click. You can also sync it to Google or Apple Calendar.",
      },
    ],
  },
  {
    path: "/watchlist",
    search: "?tab=currently_watching",
    steps: [
      {
        element: "[data-tour='watchlist-header']",
        title: "Watching",
        description:
          "Everything you're watching now. Mark episodes as you go; when you finish the last one, the show moves to Watched on its own.",
      },
    ],
  },
  {
    path: "/watchlist",
    search: "?tab=all",
    steps: [
      {
        element: "[data-tour='watchlist-header']",
        title: "Your Watchlist",
        description:
          "Everything you want to watch later. Sort, filter by type, or drag to re-order your queue. Finished shows come back here when a new season appears.",
      },
    ],
  },
  {
    path: "/settings",
    hash: "#notifications",
    steps: [
      {
        element: "[data-tour='notifications-toggle']",
        title: "Notifications",
        description:
          "Turn on email to get a daily digest, season premiere alerts, trailer drops and streaming arrivals. You can choose the hour your digest arrives.",
      },
    ],
  },
  {
    path: "/settings",
    hash: "#streaming",
    steps: [
      {
        element: "[data-tour='streaming-settings']",
        title: "Streaming services",
        description:
          "The services you subscribe to. We'll tell you when something on your list arrives on one, and the Watchlist Optimizer shows which services cover the most of it.",
      },
    ],
  },
  {
    path: "/friends",
    steps: [
      {
        element: "[data-tour='friends-header']",
        title: "Friends",
        description:
          "Find friends, see what they're watching, and share recommendations.",
      },
    ],
  },
];

// Populate offsets and total after TOUR_GROUPS is defined
let _offset = 0;
for (const g of TOUR_GROUPS) {
  GROUP_OFFSETS.push(_offset);
  _offset += g.steps.length;
}
const TOTAL_STEPS = _offset;

export default function SpotlightTourImpl() {
  const authUser = useAuthUser();
  const { data: dbUser, isLoading } = useUserMe();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const navigatingRef = useRef(false);
  const endingRef = useRef(false);
  const driverRef = useRef<ReturnType<typeof driver> | null>(null);
  const [lbDismissing, setLbDismissing] = useState(false);

  async function endTour() {
    endingRef.current = true;
    sessionStorage.removeItem(SESSION_KEY);
    navigate("/calendar");
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

  // A failed request re-enables the setup buttons so the user isn't stuck.
  async function handleLbImportNow() {
    setLbDismissing(true);
    sessionStorage.setItem(LB_IMPORTING_KEY, "1");
    try {
      await dismissLbPrompt();
      navigate("/import");
    } catch (error) {
      console.error("Couldn't finish setup:", error);
      sessionStorage.removeItem(LB_IMPORTING_KEY);
    } finally {
      setLbDismissing(false);
    }
  }

  async function handleLbSkip() {
    setLbDismissing(true);
    try {
      await dismissLbPrompt();
    } catch (error) {
      console.error("Couldn't finish setup:", error);
    } finally {
      setLbDismissing(false);
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
    if (endingRef.current) return;
    if (dbUser.onboarding_completed) {
      sessionStorage.removeItem(SESSION_KEY);
      return;
    }

    // Wait for the setup flow to be finished or skipped before starting the tour
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
    const expectedHash = group.hash ?? "";
    const expectedSearch = group.search ?? "";
    if (
      location.pathname !== group.path ||
      location.hash !== expectedHash ||
      (expectedSearch && location.search !== expectedSearch)
    ) {
      navigatingRef.current = true;
      navigate(group.path + expectedSearch + expectedHash);
      return;
    }

    navigatingRef.current = false;
    const isLastGroup = groupIndex === TOUR_GROUPS.length - 1;

    // Wait one tick for any page content to mount
    const timer = setTimeout(() => {
      driverRef.current?.destroy();

      const updateGlobalProgress = () => {
        const current = driverRef.current?.getActiveIndex() ?? 0;
        const globalCurrent = GROUP_OFFSETS[groupIndex] + current + 1;
        const progressEl = document.querySelector(".driver-popover-progress-text");
        if (progressEl) progressEl.textContent = `${globalCurrent} of ${TOTAL_STEPS}`;
      };

      const driverInst = driver({
        animate: true,
        smoothScroll: true,
        overlayOpacity: 0.75,
        stagePadding: 6,
        allowClose: true,
        showProgress: true,
        popoverClass: "rr-tour-popover",
        nextBtnText: "Next",
        prevBtnText: "Back",
        doneBtnText: isLastGroup ? "Finish" : "Next",
        onHighlighted: updateGlobalProgress,
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
              navigate(nextGroup.path + (nextGroup.search ?? "") + (nextGroup.hash ?? ""));
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
  }, [location.pathname, location.search, location.hash, dbUser?.onboarding_completed, dbUser?.letterboxd_prompted, isLoading]);

  // First-run setup (titles, favorites, services, Letterboxd) before the tour.
  // Finishing or skipping it sets letterboxd_prompted, which starts the tour.
  if (!isLoading && authUser && dbUser && !dbUser.onboarding_completed && !dbUser.letterboxd_prompted) {
    return <SetupFlow onFinish={handleLbSkip} onImport={handleLbImportNow} busy={lbDismissing} />;
  }

  return null;
}
