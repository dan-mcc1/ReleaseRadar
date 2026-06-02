import { Link, useLocation } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";

export default function NotFound() {
  usePageTitle("Page not found");
  const { pathname } = useLocation();

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 py-24 text-center">
      <p className="text-amber-400 text-sm font-semibold tracking-widest uppercase mb-4">
        404
      </p>
      <h1 className="text-3xl sm:text-4xl font-bold text-white mb-3">
        Page not found
      </h1>
      <p className="text-neutral-400 leading-relaxed mb-8">
        We couldn't find anything at{" "}
        <code className="text-neutral-300 bg-neutral-900 px-1.5 py-0.5 rounded">
          {pathname}
        </code>
        . The link might be broken, or the page may have moved.
      </p>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          to="/"
          className="px-5 py-2 rounded-md bg-amber-400 text-neutral-950 text-sm font-medium hover:bg-amber-300 transition-colors"
        >
          Back to home
        </Link>
        <Link
          to="/search"
          className="px-5 py-2 rounded-md border border-neutral-700 text-neutral-200 text-sm font-medium hover:border-neutral-500 transition-colors"
        >
          Search
        </Link>
        <Link
          to="/trending"
          className="px-5 py-2 rounded-md border border-neutral-700 text-neutral-200 text-sm font-medium hover:border-neutral-500 transition-colors"
        >
          What's trending
        </Link>
      </div>
    </div>
  );
}
