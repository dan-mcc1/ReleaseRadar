import { useState } from "react";
import { useShowProgress } from "../hooks/api/useBingePlan";
import { useSetFinishByGoal, useClearFinishByGoal } from "../hooks/api/useFinishByGoal";
import { useSubscription } from "../hooks/api/useSubscription";
import { isPremiumFeature } from "../config/features";

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export default function BingePlanWidget({ showId }: { showId: number }) {
  const { isPremium } = useSubscription();
  const { data, isPending } = useShowProgress(showId);
  const setGoal = useSetFinishByGoal(showId);
  const clearGoal = useClearFinishByGoal(showId);
  const [editing, setEditing] = useState(false);
  const [dateInput, setDateInput] = useState("");

  if (isPremiumFeature("bingePlanner") && !isPremium) return null;
  if (isPending || !data || data.remaining_episodes === 0) return null;

  const pct = data.total_episodes > 0
    ? Math.round((data.watched_episodes / data.total_episodes) * 100)
    : 0;

  const canSetGoal = isPremium || !isPremiumFeature("finishByGoal");

  const today = new Date().toISOString().split("T")[0];

  function handleSetGoal() {
    if (!dateInput) return;
    setGoal.mutate(dateInput, { onSuccess: () => setEditing(false) });
  }

  function handleClear() {
    clearGoal.mutate();
    setEditing(false);
    setDateInput("");
  }

  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <svg className="w-4 h-4 text-primary-400 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
          <circle cx="12" cy="12" r="10" />
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2" />
        </svg>
        <h3 className="text-sm font-semibold text-white">Progress</h3>
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

      {/* Finish-by goal — premium only */}
      {canSetGoal && (
        <div className="border-t border-neutral-800 pt-3 space-y-2">
          {data.finish_by_date && !editing ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-xs text-neutral-500 mb-0.5">Finish by goal</p>
                <p className="text-sm font-semibold text-white">{fmtDate(data.finish_by_date)}</p>
                {data.eps_per_day_needed !== null && data.mins_per_day_needed !== null ? (
                  <p className="text-xs text-primary-400 mt-0.5">
                    {data.eps_per_day_needed} ep/day &middot; ~{fmtMins(data.mins_per_day_needed)}/day
                  </p>
                ) : (
                  <p className="text-xs text-red-400 mt-0.5">Goal date has passed</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={() => { setDateInput(data.finish_by_date!); setEditing(true); }}
                  className="text-xs text-neutral-400 hover:text-white transition-colors px-2 py-1 rounded hover:bg-neutral-800"
                >
                  Edit
                </button>
                <button
                  onClick={handleClear}
                  disabled={clearGoal.isPending}
                  className="text-xs text-neutral-400 hover:text-red-400 transition-colors px-2 py-1 rounded hover:bg-neutral-800"
                >
                  Clear
                </button>
              </div>
            </div>
          ) : editing ? (
            <div className="space-y-2">
              <p className="text-xs text-neutral-500">Set finish by date</p>
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={dateInput}
                  min={today}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="flex-1 bg-neutral-800 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-primary-500"
                />
                <button
                  onClick={handleSetGoal}
                  disabled={!dateInput || setGoal.isPending}
                  className="px-3 py-1.5 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={() => setEditing(false)}
                  className="px-3 py-1.5 text-neutral-400 hover:text-white text-sm rounded-lg hover:bg-neutral-800 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="flex items-center gap-1.5 text-xs text-neutral-500 hover:text-primary-400 transition-colors group"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path strokeLinecap="round" d="M16 2v4M8 2v4M3 10h18" />
              </svg>
              Set a finish by date
            </button>
          )}
        </div>
      )}
    </div>
  );
}
