import { useEffect, useState } from "react";

const DISMISSED_KEY = "pwa-install-dismissed";

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

function isInStandaloneMode() {
  return (
    ("standalone" in navigator && (navigator as any).standalone === true) ||
    window.matchMedia("(display-mode: standalone)").matches
  );
}

export default function InstallBanner() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showIOS, setShowIOS] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already installed or previously dismissed
    if (isInStandaloneMode()) return;
    if (localStorage.getItem(DISMISSED_KEY)) return;

    if (isIOS()) {
      setShowIOS(true);
      setVisible(true);
      return;
    }
  }, []);

  function dismiss() {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  }

  async function install() {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setVisible(false);
    setDeferredPrompt(null);
  }

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-sm">
      <div className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <img
              src="/logo-512.png"
              className="w-10 h-10 rounded-xl flex-shrink-0"
              alt=""
            />
            <div>
              <p className="text-white font-semibold text-sm">
                Add to Home Screen
              </p>
              <p className="text-slate-400 text-xs">
                Use Release Radar like an app
              </p>
            </div>
          </div>
          <button
            onClick={dismiss}
            className="text-slate-500 hover:text-slate-300 mt-0.5 flex-shrink-0"
          >
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
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {showIOS ? (
          <p className="text-slate-300 text-xs leading-relaxed">
            Tap the{" "}
            <span className="inline-flex items-center gap-0.5 text-blue-400 font-medium">
              Share
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"
                />
              </svg>
            </span>{" "}
            button in Safari, then tap{" "}
            <span className="text-white font-medium">"Add to Home Screen"</span>
            .
          </p>
        ) : (
          <button
            onClick={install}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold py-2 rounded-lg transition-colors"
          >
            Add to Home Screen
          </button>
        )}
      </div>
    </div>
  );
}
