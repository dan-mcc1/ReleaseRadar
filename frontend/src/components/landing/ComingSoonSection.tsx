import { Link } from "react-router-dom";
import MediaList from "../MediaList";
import { useComingSoon } from "../../hooks/api/useSearch";

export default function ComingSoonSection() {
  const today = new Date();
  const minDate = today.toISOString().split("T")[0];
  const nextMonth = new Date(today);
  nextMonth.setMonth(nextMonth.getMonth() + 1);
  const maxDate = nextMonth.toISOString().split("T")[0];

  const { data: movies = [], isPending: loading } = useComingSoon(minDate, maxDate);

  if (loading)
    return (
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );

  if (!movies.length) return null;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-white">Coming Soon</h2>
        <Link to="/upcoming" className="text-sm text-primary-400 hover:text-primary-300 transition-colors">
          See all →
        </Link>
      </div>
      <MediaList results={{ movies: movies.slice(0, 6) }} showWatchButton={false} />
    </div>
  );
}
