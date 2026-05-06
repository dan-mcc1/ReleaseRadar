import { Link } from "react-router-dom";

export default function BrowseGenresSection() {
  return (
    <div>
      <h2 className="text-2xl font-bold text-white mb-4">Browse by Genre</h2>
      <Link
        to="/browse-genres"
        className="inline-flex items-center gap-2 bg-neutral-800 hover:bg-neutral-700 border border-neutral-700 hover:border-neutral-600 text-neutral-200 font-medium px-5 py-3 rounded-xl transition-colors"
      >
        <svg className="w-5 h-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 10h16M4 14h16M4 18h16" />
        </svg>
        Browse all genres
      </Link>
    </div>
  );
}
