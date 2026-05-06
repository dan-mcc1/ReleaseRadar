import { Link } from "react-router-dom";

export default function Footer() {
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
            <Link
              to="/settings"
              className="hover:text-neutral-300 transition-colors"
            >
              Settings
            </Link>
          </div>

          {/* TMDB attribution */}
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <span>Data provided by</span>
            <a
              href="https://www.themoviedb.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-neutral-400 transition-colors underline underline-offset-2"
            >
              TMDB
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
