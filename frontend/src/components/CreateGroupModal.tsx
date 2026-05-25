import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateCommunity } from "../hooks/api/useCommunities";

const COLORS = [
  { key: "blue", color: "#3b82f6" },
  { key: "green", color: "#10b981" },
  { key: "purple", color: "#a855f7" },
  { key: "pink", color: "#ec4899" },
  { key: "orange", color: "#f97316" },
  { key: "amber", color: "#f59e0b" },
  { key: "teal", color: "#14b8a6" },
  { key: "red", color: "#ef4444" },
];

export default function CreateGroupModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateCommunity();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [color, setColor] = useState<string | null>(COLORS[0].color);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    try {
      const c = await create.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        visibility,
        banner_color: color,
      });
      onClose();
      navigate(`/groups/${c.slug}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create group.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="bg-neutral-900 border border-neutral-800 rounded-2xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-[18px] font-semibold text-white mb-1">Create a group</h3>
        <p className="text-[13px] text-neutral-400 mb-5">
          Start a community around a genre, theme, or any movie/TV vibe.
        </p>

        <label className="block mb-4">
          <span className="text-[12px] text-neutral-400 font-medium">Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={80}
            placeholder="Anime obsessives"
            className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none focus:border-neutral-600"
          />
        </label>

        <label className="block mb-4">
          <span className="text-[12px] text-neutral-400 font-medium">
            Description{" "}
            <span className="text-neutral-600">(optional)</span>
          </span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="What's this group about?"
            className="mt-1 w-full bg-neutral-950 border border-neutral-800 rounded-xl px-3 py-2.5 text-sm text-white placeholder-neutral-600 outline-none resize-none focus:border-neutral-600"
          />
        </label>

        <div className="mb-4">
          <span className="text-[12px] text-neutral-400 font-medium block mb-2">Visibility</span>
          <div className="grid grid-cols-2 gap-2">
            {(["public", "private"] as const).map((v) => (
              <button
                key={v}
                onClick={() => setVisibility(v)}
                className={`px-3 py-2 rounded-xl text-sm font-medium border transition-colors ${
                  visibility === v
                    ? "border-primary-500/50 bg-primary-600/10 text-white"
                    : "border-neutral-700/50 text-neutral-300 hover:border-neutral-600"
                }`}
              >
                {v === "public" ? "Public" : "Private"}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-neutral-500 mt-1.5">
            {visibility === "public"
              ? "Anyone can find and join."
              : "Invite-only. Hidden from browse."}
          </p>
        </div>

        <div className="mb-5">
          <span className="text-[12px] text-neutral-400 font-medium block mb-2">Color</span>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c.key}
                onClick={() => setColor(c.color)}
                style={{ backgroundColor: c.color }}
                className={`w-7 h-7 rounded-full transition-all ${
                  color === c.color
                    ? "ring-2 ring-white ring-offset-2 ring-offset-neutral-900"
                    : "opacity-70 hover:opacity-100"
                }`}
              />
            ))}
          </div>
        </div>

        {error && <p className="text-error-400 text-sm mb-3">{error}</p>}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-sm py-2.5 rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={create.isPending || name.trim().length < 2}
            className="flex-1 bg-primary-600 hover:bg-primary-500 disabled:opacity-50 text-white text-sm py-2.5 rounded-xl font-medium"
          >
            {create.isPending ? "Creating…" : "Create group"}
          </button>
        </div>
      </div>
    </div>
  );
}
