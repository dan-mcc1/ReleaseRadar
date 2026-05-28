import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateLeague } from "../hooks/api/useFantasy";

export default function CreateLeagueModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateLeague();
  const [name, setName] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [startingBudget, setStartingBudget] = useState(200);
  const [movieSlots, setMovieSlots] = useState(4);
  const [tvSlots, setTvSlots] = useState(3);
  const [flexSlots, setFlexSlots] = useState(1);
  const [benchSlots, setBenchSlots] = useState(4);
  const [maxMembers, setMaxMembers] = useState(12);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      const league = await create.mutateAsync({
        name: name.trim(),
        starting_budget: startingBudget,
        roster_movie_slots: movieSlots,
        roster_tv_slots: tvSlots,
        roster_flex_slots: flexSlots,
        bench_slots: benchSlots,
        max_members: maxMembers,
      });
      onClose();
      navigate(`/fantasy/${league.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create league.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[18px] font-semibold text-white mb-1">
          Create a fantasy league
        </h3>
        <p className="text-[13px] text-neutral-400 mb-5">
          Draft movies and shows, score against your friends across a 3-month season.
        </p>

        <label className="block mb-4">
          <span className="text-[12px] text-neutral-400 font-medium">League name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="The Big Screen Showdown"
            className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600"
          />
        </label>

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[12px] text-neutral-400 hover:text-neutral-200 mb-4"
        >
          {showAdvanced ? "Hide" : "Show"} advanced settings
        </button>

        {showAdvanced && (
          <div className="space-y-3 mb-4 pb-4 border-b border-neutral-800">
            <NumberField
              label="Starting auction budget"
              value={startingBudget}
              onChange={setStartingBudget}
              min={50}
              max={1000}
              hint="Each player starts the draft with this much to bid."
            />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <NumberField
                label="Movie slots"
                value={movieSlots}
                onChange={setMovieSlots}
                min={1}
                max={15}
              />
              <NumberField
                label="TV slots"
                value={tvSlots}
                onChange={setTvSlots}
                min={0}
                max={15}
              />
              <NumberField
                label="Flex slots"
                value={flexSlots}
                onChange={setFlexSlots}
                min={0}
                max={5}
              />
              <NumberField
                label="Bench slots"
                value={benchSlots}
                onChange={setBenchSlots}
                min={0}
                max={10}
              />
            </div>
            <NumberField
              label="Max members"
              value={maxMembers}
              onChange={setMaxMembers}
              min={2}
              max={24}
            />
          </div>
        )}

        {error && (
          <p className="text-[12px] text-red-400 mb-3 bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="text-sm font-medium text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-600 px-4 py-2 rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!name.trim() || create.isPending}
            className="text-sm font-semibold bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl"
          >
            {create.isPending ? "Creating…" : "Create league"}
          </button>
        </div>
      </div>
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
  hint,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  hint?: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] text-neutral-400 font-medium">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (!Number.isNaN(n)) onChange(n);
        }}
        className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2 text-sm text-white outline-none focus:border-neutral-600"
      />
      {hint && <span className="text-[11px] text-neutral-500 block mt-1">{hint}</span>}
    </label>
  );
}
