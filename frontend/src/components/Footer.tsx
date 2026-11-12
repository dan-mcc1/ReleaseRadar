import { Link } from "react-router-dom";
import { useAuthUser } from "../hooks/useAuthUser";

export default function Footer() {
  const user = useAuthUser();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-auto border-t border-neutral-800 bg-neutral-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex flex-col items-center sm:items-start gap-1">
            <span className="text-white font-semibold text-sm">
              Release Radar
            </span>
            <span className="text-neutral-500 text-xs">
              © {year} Release Radar. All rights reserved.
            </span>
          </div>

          {/* Links */}
          <div className="flex flex-wrap justify-center gap-x-6 gap-y-2 text-xs text-neutral-500">
            <Link
              to="/trending"
              className="hover:text-neutral-300 transition-colors"
            >
              Trending
            </Link>
            <Link
              to="/upcoming"
              className="hover:text-neutral-300 transition-colors"
            >
              Upcoming
            </Link>
            <Link
              to="/browse-genres"
              className="hover:text-neutral-300 transition-colors"
            >
              Browse
            </Link>
            <Link
              to="/box-office"
              className="hover:text-neutral-300 transition-colors"
            >
              Box Office
            </Link>
            {user && (
              <Link
                to="/settings"
                className="hover:text-neutral-300 transition-colors"
              >
                Settings
              </Link>
            )}
            <Link
              to="/community-guidelines"
              className="hover:text-neutral-300 transition-colors"
            >
              Community Guidelines
            </Link>
            <Link
              to="/terms"
              className="hover:text-neutral-300 transition-colors"
            >
              Terms
            </Link>
            <Link
              to="/privacy"
              className="hover:text-neutral-300 transition-colors"
            >
              Privacy
            </Link>
            <Link
              to="/feedback"
              className="hover:text-neutral-300 transition-colors"
            >
              Feedback
            </Link>
          </div>

          {/* Data attribution: TMDb's terms require its logo, JustWatch's
              require a credit wherever its streaming data is shown. Served
              from /public because TMDb's hosted logo URLs change. */}
          <div className="flex items-center gap-3 text-caption text-neutral-400">
            <a
              href="https://www.themoviedb.org"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 hover:opacity-80 transition-opacity"
            >
              <img
                src="/tmdb-logo.svg"
                alt="The Movie Database (TMDB)"
                width={185}
                height={133}
                className="h-8 w-auto"
              />
            </a>
            <span>
              Streaming data by{" "}
              <a
                href="https://www.justwatch.com"
                target="_blank"
                rel="noopener noreferrer"
                className="text-neutral-200 hover:text-white transition-colors"
              >
                JustWatch
              </a>
            </span>
          </div>
        </div>

        <p className="mt-6 text-center sm:text-left text-caption text-neutral-400">
          This product uses the TMDB API but is not endorsed or certified by
          TMDB.
        </p>
      </div>
    </footer>
  );
}
