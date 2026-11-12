import { useState } from "react";
import { useShowProgress } from "../hooks/api/useBingePlan";
import { useSetFinishByGoal, useClearFinishByGoal } from "../hooks/api/useFinishByGoal";
import { useSubscription } from "../hooks/api/useSubscription";
import { isPremiumFeature } from "../config/features";
import { toLocalISODate } from "../utils/date";
import { CalendarDaysIcon } from "@heroicons/react/24/outline";
import { Button, Card, SectionHeader } from "./ui";

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

  const today = toLocalISODate(new Date());

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
    <Card padding="sm" className="space-y-3">
      <SectionHeader title="Progress" as="h3" />

      {/* Progress bar */}
      <div>
        <div className="flex items-center justify-between mb-1.5 text-caption text-neutral-400">
          <span>{data.watched_episodes} / {data.total_episodes} episodes</span>
          <span>{pct}%</span>
        </div>
        <div className="h-2 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-primary-500 rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Stats row */}
      <div className="flex flex-wrap gap-4 text-body">
        <div>
          <p className="text-caption text-neutral-400">Time remaining</p>
          <p className="font-semibold text-white tabular">{fmtMins(data.remaining_minutes)}</p>
        </div>
        <div>
          <p className="text-caption text-neutral-400">Episodes left</p>
          <p className="font-semibold text-white tabular">{data.remaining_episodes}</p>
        </div>
        {data.eps_per_week_recent !== null && (
          <div>
            <p className="text-caption text-neutral-400">Your pace</p>
            <p className="font-semibold text-white tabular">{data.eps_per_week_recent} ep/week</p>
          </div>
        )}
        {data.completion_estimate && (
          <div>
            <p className="text-caption text-neutral-400">At this pace</p>
            <p className="font-semibold text-white">{data.completion_estimate}</p>
          </div>
        )}
      </div>

      {/* Finish-by goal — premium only */}
      {canSetGoal && (
        <div className="border-t border-neutral-800 pt-3 space-y-2">
          {data.finish_by_date && !editing ? (
            <div className="flex items-center justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-caption text-neutral-400 mb-0.5">Finish by goal</p>
                <p className="text-body font-semibold text-white">{fmtDate(data.finish_by_date)}</p>
                {data.eps_per_day_needed !== null && data.mins_per_day_needed !== null ? (
                  <p className="text-caption text-neutral-300 mt-0.5">
                    {data.eps_per_day_needed} ep/day &middot; ~{fmtMins(data.mins_per_day_needed)}/day
                  </p>
                ) : (
                  <p className="text-caption text-error-400 mt-0.5">Goal date has passed</p>
                )}
              </div>
              <div className="flex gap-2 shrink-0">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { setDateInput(data.finish_by_date!); setEditing(true); }}
                >
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  disabled={clearGoal.isPending}
                >
                  Clear
                </Button>
              </div>
            </div>
          ) : editing ? (
            <div className="space-y-2">
              <p className="text-caption text-neutral-400">Set finish by date</p>
              <div className="flex gap-2 items-center">
                <input
                  type="date"
                  value={dateInput}
                  min={today}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="flex-1 h-control bg-neutral-900 border border-neutral-700 rounded-control px-3 text-label text-white [color-scheme:dark] hover:border-neutral-500 focus:outline-none focus:border-neutral-400"
                />
                <Button
                  variant="primary"
                  onClick={handleSetGoal}
                  disabled={!dateInput || setGoal.isPending}
                >
                  Save
                </Button>
                <Button variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEditing(true)}
              icon={<CalendarDaysIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
            >
              Set a finish by date
            </Button>
          )}
        </div>
      )}
    </Card>
  );
}
