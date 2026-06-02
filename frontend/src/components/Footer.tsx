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

          {/* TMDB attribution */}
          <div className="flex items-center gap-2 text-xs text-neutral-600">
            <span>Data provided by</span>
            <a
              href="https://www.themoviedb.org"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:opacity-80 transition-opacity"
            >
              <img
                src="https://www.themoviedb.org/assets/2/v4/logos/v2/blue_short-8e7b30f73a4020692ccca9c88bafe5dcb6f8a62a4c6bc55cd9ba82bb2cd95f6c.svg"
                alt="The Movie Database"
                className="h-4 w-auto"
              />
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
