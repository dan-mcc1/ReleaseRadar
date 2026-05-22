import { useState, useEffect, useRef } from "react";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  useShelves,
  useItemShelves,
  useCreateShelf,
  useAddToShelf,
  useRemoveFromShelf,
} from "../hooks/api/useShelves";
import { useSubscription } from "../hooks/api/useSubscription";
import { isPremiumFeature } from "../config/features";
import ProUpgradeModal from "./ProUpgradeModal";
import { useToast } from "./Toast";

interface ShelfButtonProps {
  contentType: "movie" | "tv";
  contentId: number;
  compact?: boolean;
}

// ── Icons ──────────────────────────────────────────────────────────────────

function IconBookmarkShelf({ active }: { active: boolean }) {
  return active ? (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
      <path d="M19 3H5a2 2 0 00-2 2v16l7-3.5L17 21V5a2 2 0 00-2-2zM9 10l2 2 4-4" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        stroke="white"
        fill="none"
        d="M9 10l2 2 4-4"
      />
    </svg>
  ) : (
    <svg
      className="w-4 h-4"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19 3H5a2 2 0 00-2 2v16l7-3.5L17 21V5a2 2 0 00-2-2z"
      />
    </svg>
  );
}

function IconChevronDown() {
  return (
    <svg
      className="w-3.5 h-3.5"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2.5}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

function IconPlus() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m-8-8h16" />
    </svg>
  );
}

// ── Component ──────────────────────────────────────────────────────────────

export default function ShelfButton({ contentType, contentId, compact = false }: ShelfButtonProps) {
  const user = useAuthUser();
  const { isPremium } = useSubscription();
  const toast = useToast();
  const shelvesGated = isPremiumFeature("shelves") && !isPremium;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showNewInput, setShowNewInput] = useState(false);
  const [newShelfName, setNewShelfName] = useState("");
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: shelves = [] } = useShelves();
  const { data: itemShelfIds = [] } = useItemShelves(contentType, contentId);
  const createShelf = useCreateShelf();
  const addToShelf = useAddToShelf();
  const removeFromShelf = useRemoveFromShelf();

  const shelfCount = itemShelfIds.length;
  const hasAnyShelves = shelfCount > 0;
  const isMutating = addToShelf.isPending || removeFromShelf.isPending || createShelf.isPending;

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setShowNewInput(false);
        setNewShelfName("");
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (showNewInput) {
      inputRef.current?.focus();
    }
  }, [showNewInput]);

  async function handleToggleShelf(shelfId: number) {
    if (!user) {
      toast.error("You must be signed in.");
      return;
    }
    const isOn = itemShelfIds.includes(shelfId);
    try {
      if (isOn) {
        await removeFromShelf.mutateAsync({ shelfId, contentType, contentId });
      } else {
        await addToShelf.mutateAsync({ shelfId, contentType, contentId });
      }
    } catch {
      toast.error("Failed to update shelf");
    }
  }

  async function handleCreateShelf() {
    const name = newShelfName.trim();
    if (!name) return;
    try {
      const shelf = await createShelf.mutateAsync({ name });
      await addToShelf.mutateAsync({ shelfId: shelf.id, contentType, contentId });
      setNewShelfName("");
      setShowNewInput(false);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "upgrade_required") {
        setMenuOpen(false);
        setShowUpgradeModal(true);
      } else {
        toast.error("Failed to create shelf");
      }
    }
  }

  const mainClass = hasAnyShelves
    ? "bg-neutral-700 hover:bg-neutral-600 text-sky-300 border border-sky-500/60"
    : "bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-600";
  const chevronClass = hasAnyShelves
    ? "bg-neutral-700 hover:bg-neutral-600 border-l border-sky-500/40 text-sky-400"
    : "bg-neutral-800 hover:bg-neutral-700 border-l border-neutral-600 text-neutral-400";

  return (
    <div className="relative inline-flex" ref={dropdownRef}>
      {/* Main button */}
      <button
        disabled={isMutating}
        onClick={() => {
          if (!user) {
            toast.error("You must be signed in.");
            return;
          }
          if (shelvesGated) {
            setShowUpgradeModal(true);
            return;
          }
          setMenuOpen((o) => !o);
        }}
        className={`flex items-center gap-2 ${compact ? "px-2.5 sm:px-4 py-2" : "px-4 py-2"} text-sm font-semibold rounded-l-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${mainClass}`}
      >
        {isMutating ? <IconSpinner /> : <IconBookmarkShelf active={hasAnyShelves} />}
        {compact ? (
          <span className="hidden sm:inline">
            {hasAnyShelves ? `Shelves (${shelfCount})` : "Add to Shelf"}
          </span>
        ) : hasAnyShelves ? (
          `Shelves (${shelfCount})`
        ) : (
          "Add to Shelf"
        )}
      </button>

      {/* Chevron toggle */}
      <button
        disabled={isMutating}
        onClick={() => {
          if (!user) return;
          if (shelvesGated) {
            setShowUpgradeModal(true);
            return;
          }
          setMenuOpen((o) => !o);
        }}
        className={`flex items-center justify-center px-2.5 rounded-r-xl transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${chevronClass}`}
        aria-label="Toggle shelf menu"
      >
        <span className={`transition-transform duration-200 ${menuOpen ? "rotate-180" : ""}`}>
          <IconChevronDown />
        </span>
      </button>

      {/* Dropdown */}
      {menuOpen && (
        <div
          className={`absolute top-full mt-2 w-60 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden ${compact ? "right-0 sm:right-auto sm:left-0" : "left-0"}`}
        >
          {shelves.length === 0 && !showNewInput && (
            <p className="px-4 py-3 text-sm text-neutral-400">No shelves yet</p>
          )}

          {shelves.map((shelf) => {
            const isOn = itemShelfIds.includes(shelf.id);
            return (
              <button
                key={shelf.id}
                onClick={() => handleToggleShelf(shelf.id)}
                className="flex items-center justify-between w-full text-left px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors"
              >
                <span className="truncate pr-2">{shelf.name}</span>
                {isOn && (
                  <span className="text-sky-400 shrink-0">
                    <IconCheck />
                  </span>
                )}
              </button>
            );
          })}

          <div className="border-t border-neutral-700 mx-3" />

          {showNewInput ? (
            <div className="px-3 py-2 flex gap-2">
              <input
                ref={inputRef}
                value={newShelfName}
                onChange={(e) => setNewShelfName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateShelf();
                  if (e.key === "Escape") {
                    setShowNewInput(false);
                    setNewShelfName("");
                  }
                }}
                placeholder="Shelf name…"
                className="flex-1 min-w-0 bg-neutral-700 border border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-sky-500"
              />
              <button
                onClick={handleCreateShelf}
                disabled={!newShelfName.trim() || createShelf.isPending}
                className="px-3 py-1.5 text-sm font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-50 transition-colors"
              >
                {createShelf.isPending ? <IconSpinner /> : "Add"}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setShowNewInput(true)}
              className="flex items-center gap-2 w-full text-left px-4 py-3 text-sm text-neutral-400 hover:text-neutral-200 hover:bg-neutral-700 transition-colors"
            >
              <IconPlus />
              New shelf
            </button>
          )}
        </div>
      )}
      {showUpgradeModal && (
        <ProUpgradeModal feature="shelves" onClose={() => setShowUpgradeModal(false)} />
      )}
    </div>
  );
}
