import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { API_URL } from "../constants";
import { queryFetch } from "../hooks/api/queryFetch";
import { queryKeys } from "../hooks/api/queryKeys";
import { useAuthUser } from "../hooks/useAuthUser";

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

interface Instruction {
  name: string;
  icon: React.ReactNode;
  steps: string[];
}

const INSTRUCTIONS: Instruction[] = [
  {
    name: "Google Calendar",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
        <rect
          x="3"
          y="4"
          width="18"
          height="17"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 2v4M16 2v4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
    steps: [
      'Open Google Calendar and click the "+" next to "Other calendars"',
      'Select "From URL"',
      "Paste your feed URL and click 'Add calendar'",
    ],
  },
  {
    name: "Outlook",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
        <rect
          x="2"
          y="4"
          width="20"
          height="16"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path
          d="M2 9l10 6 10-6"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
        />
      </svg>
    ),
    steps: [
      "Go to Outlook Calendar and click 'Add calendar'",
      'Select "Subscribe from web"',
      "Paste your feed URL and click 'Import'",
      "Wait a few minutes for the events to populate your calendar",
    ],
  },
  {
    name: "Apple Calendar",
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
        <rect
          x="3"
          y="4"
          width="18"
          height="17"
          rx="2"
          stroke="currentColor"
          strokeWidth="1.5"
        />
        <path d="M3 9h18" stroke="currentColor" strokeWidth="1.5" />
        <path
          d="M8 2v4M16 2v4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <path
          d="M8 14h8M8 17h5"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
      </svg>
    ),
    steps: [
      "In the Calendar app, go to your calendars",
      "Click 'Add Calendar' then click 'Add Subscription Calendar'",
      "Paste your feed URL and click 'Find'",
      "Set your preferred auto-refresh interval",
    ],
  },
];

export default function CalendarSyncModal({ isOpen, onClose }: Props) {
  const user = useAuthUser();
  const [copied, setCopied] = useState(false);
  const [openInstructions, setOpenInstructions] = useState<string | null>(null);

  const { data: tokenData, isLoading: loading } = useQuery({
    queryKey: queryKeys.icalToken(user?.uid ?? ""),
    queryFn: () => queryFetch<{ token: string }>("/ical/token"),
    enabled: !!user && isOpen,
    staleTime: Infinity,
  });

  const feedUrl = tokenData?.token ? `${API_URL}/ical/feed/${tokenData.token}` : null;

  function copyUrl() {
    if (!feedUrl) return;
    navigator.clipboard.writeText(feedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-lg bg-neutral-900 border border-neutral-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-700">
          <div className="flex items-center gap-2.5">
            <svg
              className="w-5 h-5 text-primary-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.8}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
            <h2 className="text-base font-semibold text-white">
              Sync with Your Calendar
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-neutral-400 hover:text-white transition-colors rounded-lg p-1 hover:bg-neutral-700"
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
        </div>

        <div className="px-6 py-5 flex flex-col gap-5 overflow-y-auto">
          {/* Explanation */}
          <p className="text-sm text-neutral-400 leading-relaxed">
            Subscribe to your personal calendar feed to see your tracked TV
            episodes and movies directly in Google Calendar, Outlook, Apple
            Calendar, or any app that supports iCal.
          </p>

          {/* URL box */}
          <div>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              Your feed URL
            </p>
            <div className="flex items-stretch gap-2">
              <div className="flex-1 min-w-0 bg-neutral-800 border border-neutral-600 rounded-xl px-3 py-2.5 text-xs text-neutral-300 font-mono truncate flex items-center">
                {loading ? (
                  <span className="text-neutral-500">Generating URL…</span>
                ) : feedUrl ? (
                  feedUrl
                ) : (
                  <span className="text-error-500">
                    Failed to load — please refresh
                  </span>
                )}
              </div>
              <button
                onClick={copyUrl}
                disabled={!feedUrl || loading}
                className={`flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium transition-all border ${
                  copied
                    ? "bg-emerald-600/20 border-emerald-600/40 text-emerald-400"
                    : "bg-neutral-700 border-neutral-600 text-neutral-200 hover:bg-neutral-600 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed"
                }`}
              >
                {copied ? (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M5 13l4 4L19 7"
                      />
                    </svg>
                    Copied
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                    Copy
                  </>
                )}
              </button>
            </div>
            <p className="mt-1.5 text-xs text-neutral-500">
              Keep this URL private — it gives read access to your watchlist.
            </p>
          </div>

          {/* Per-app instructions */}
          <div>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              How to subscribe
            </p>
            <div className="flex flex-col gap-1.5">
              {INSTRUCTIONS.map((app) => (
                <div
                  key={app.name}
                  className="rounded-xl border border-neutral-700 overflow-hidden"
                >
                  <button
                    onClick={() =>
                      setOpenInstructions(
                        openInstructions === app.name ? null : app.name,
                      )
                    }
                    className="w-full flex items-center justify-between px-4 py-3 bg-neutral-800 hover:bg-neutral-750 text-left transition-colors"
                    style={{
                      backgroundColor:
                        openInstructions === app.name
                          ? "rgb(30,41,59)"
                          : undefined,
                    }}
                  >
                    <span className="flex items-center gap-2.5 text-sm font-medium text-neutral-200">
                      <span className="text-neutral-400">{app.icon}</span>
                      {app.name}
                    </span>
                    <svg
                      className={`w-4 h-4 text-neutral-400 transition-transform duration-200 ${
                        openInstructions === app.name ? "rotate-180" : ""
                      }`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19 9l-7 7-7-7"
                      />
                    </svg>
                  </button>
                  {openInstructions === app.name && (
                    <ol className="px-4 py-3 bg-neutral-900 flex flex-col gap-2 border-t border-neutral-700">
                      {app.steps.map((step, i) => (
                        <li
                          key={i}
                          className="flex items-start gap-2.5 text-sm text-neutral-300"
                        >
                          <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary-600/20 text-primary-400 text-xs font-semibold flex items-center justify-center mt-0.5">
                            {i + 1}
                          </span>
                          {step}
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
