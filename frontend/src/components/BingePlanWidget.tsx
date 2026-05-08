import { useBingePlan } from "../hooks/api/useBingePlan";
import { useSubscription } from "../hooks/api/useSubscription";
import { isPremiumFeature } from "../config/features";

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function BingePlanWidget({ showId }: { showId: number }) {
  const { isPremium } = useSubscription();
  const { data, isPending } = useBingePlan(showId);

  if (isPremiumFeature("bingePlanner") && !isPremium) return null;
  if (isPending || !data || data.remaining_episodes === 0) return null;

  const pct = data.total_episodes > 0
    ? Math.round((data.watched_episodes / data.total_episodes) * 100)
    : 0;

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-primary-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
        </svg>
        <h3 className="text-sm font-semibold text-white">Binge Planner</h3>
      </div>

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5 text-xs text-neutral-400">
          <span>{data.watched_episodes} / {data.total_episodes} episodes</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-primary-600 to-primary-400 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 text-sm">
        <div>
          <p className="text-xs text-neutral-500">Time remaining</p>
          <p className="font-semibold text-white">{fmtMins(data.remaining_minutes)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Episodes left</p>
          <p className="font-semibold text-white">{data.remaining_episodes}</p>
        </div>
        {data.eps_per_week_recent !== null && (
          <div>
            <p className="text-xs text-neutral-500">Your pace</p>
            <p className="font-semibold text-white">{data.eps_per_week_recent} ep/week</p>
          </div>
        )}
        {data.completion_estimate && (
          <div>
            <p className="text-xs text-neutral-500">At this pace</p>
            <p className="font-semibold text-primary-400">{data.completion_estimate}</p>
          </div>
        )}
      </div>
    </div>
  );
}
