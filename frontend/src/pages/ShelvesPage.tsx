import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  useShelves,
  useCreateShelf,
  useDeleteShelf,
  useUpdateShelf,
  type Shelf,
} from "../hooks/api/useShelves";
import { usePageTitle } from "../hooks/usePageTitle";
import { useUserMe } from "../hooks/api/useUser";
import ProUpgradeModal from "../components/ProUpgradeModal";
import { BASE_IMAGE_URL } from "../constants";

const SHELF_COLORS = [
  "#10b981",
  "#3b82f6",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
];

function shelfColor(shelf: Shelf) {
  return SHELF_COLORS[shelf.id % SHELF_COLORS.length];
}

interface ShelfCardProps {
  shelf: Shelf;
  idx: number;
  color: string;
  isEditing: boolean;
  editName: string;
  menuOpen: boolean;
  onEditNameChange: (v: string) => void;
  onRename: () => void;
  onEditCancel: () => void;
  onMenuOpen: (e: React.MouseEvent) => void;
  onMenuClose: () => void;
  onStartRename: () => void;
  onStartDelete: () => void;
  onClick: () => void;
}

function ShelfCard({
  shelf,
  idx,
  color,
  isEditing,
  editName,
  menuOpen,
  onEditNameChange,
  onRename,
  onEditCancel,
  onMenuOpen,
  onMenuClose,
  onStartRename,
  onStartDelete,
  onClick,
}: ShelfCardProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handle(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onMenuClose();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [menuOpen, onMenuClose]);

  return (
    <div
      className="relative flex flex-col gap-3.5 p-5 rounded-2xl bg-neutral-800 border border-neutral-700 hover:border-neutral-600 transition-colors overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      {/* Color accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{
          background: `linear-gradient(180deg, ${color}, ${color}55)`,
        }}
      />

      {/* Top row */}
      <div className="flex items-start justify-between pl-2">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-neutral-500 mb-1.5">
            <span className="mr-2">{String(idx + 1).padStart(2, "0")}</span>
            Personal shelf
          </p>
          {isEditing ? (
            <input
              autoFocus
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onRename();
                if (e.key === "Escape") onEditCancel();
              }}
              onBlur={onRename}
              className="text-xl bg-neutral-700 border border-neutral-600 rounded-lg px-2 py-1 text-neutral-100 outline-none focus:border-primary-500 w-full"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h3 className="text-2xl font-light leading-tight tracking-tight text-neutral-100 truncate">
              {shelf.name}
            </h3>
          )}
          {shelf.description && !isEditing && (
            <p className="text-[12.5px] text-neutral-500 mt-1 leading-snug line-clamp-2">
              {shelf.description}
            </p>
          )}
        </div>

        {/* 3-dot menu */}
        <div className="relative shrink-0 ml-2" ref={menuRef}>
          <button
            onClick={onMenuOpen}
            className="w-7 h-7 flex items-center justify-center rounded-lg text-neutral-500 hover:text-neutral-300 hover:bg-neutral-700 transition-colors"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
              <circle cx="5" cy="12" r="1.5" />
              <circle cx="12" cy="12" r="1.5" />
              <circle cx="19" cy="12" r="1.5" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-8 z-20 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl py-1 min-w-[120px]">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartRename();
                }}
                className="w-full text-left px-3 py-2 text-sm text-neutral-300 hover:bg-neutral-700 transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z"
                  />
                </svg>
                Rename
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartDelete();
                }}
                className="w-full text-left px-3 py-2 text-sm text-error-400 hover:bg-neutral-700 transition-colors flex items-center gap-2"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"
                  />
                </svg>
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Poster stack + count */}
      <div className="flex items-end pl-2 mt-1">
        <div className="flex">
          {shelf.preview_posters.length > 0
            ? shelf.preview_posters.slice(0, 4).map((poster, i) => (
                <div
                  key={i}
                  className="rounded-md overflow-hidden"
                  style={{
                    marginLeft: i === 0 ? 0 : -14,
                    transform: `rotate(${(i - 1.5) * 2.5}deg)`,
                    zIndex: i,
                    boxShadow: `0 4px 10px rgba(0,0,0,0.5), 0 0 0 2px #262626`,
                    width: 52,
                    height: 78,
                    flexShrink: 0,
                  }}
                >
                  <img
                    src={`${BASE_IMAGE_URL}/w154${poster}`}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                </div>
              ))
            : (
                <div
                  className="rounded-md bg-neutral-700 border border-neutral-600 flex items-center justify-center"
                  style={{ width: 52, height: 78 }}
                >
                  <svg
                    className="w-5 h-5 text-neutral-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M19 3H5a2 2 0 00-2 2v16l7-3.5L17 21V5a2 2 0 00-2-2z"
                    />
                  </svg>
                </div>
              )}
        </div>
        <div className="flex-1" />
        <div className="text-right">
          <div className="text-4xl font-light leading-none text-neutral-100 tracking-tight">
            {shelf.item_count}
          </div>
          <div className="font-mono text-[10px] tracking-[0.08em] text-neutral-500 uppercase mt-0.5">
            {shelf.item_count === 1 ? "TITLE" : "TITLES"}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ShelvesPage() {
  usePageTitle("Shelves");
  const navigate = useNavigate();
  const { data: shelves = [], isLoading } = useShelves();
  const { data: userMe } = useUserMe();
  const createShelf = useCreateShelf();
  const deleteShelf = useDeleteShelf();
  const updateShelf = useUpdateShelf();

  const isPremium = userMe == null ? null : userMe.subscription_tier !== "free";
  const FREE_SHELF_LIMIT = 3;
  const atFreeLimit = isPremium === false && shelves.length >= FREE_SHELF_LIMIT;
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);

  const totalTitles = shelves.reduce((a, s) => a + s.item_count, 0);

  function handleNewShelf() {
    if (atFreeLimit) {
      setShowUpgradeModal(true);
      return;
    }
    setShowCreate(true);
  }

  async function handleCreate() {
    const name = newName.trim();
    if (!name) return;
    try {
      await createShelf.mutateAsync({ name });
      setNewName("");
      setShowCreate(false);
    } catch {
      alert("Failed to create shelf");
    }
  }

  async function handleRename(shelf: Shelf) {
    const name = editName.trim();
    if (!name || name === shelf.name) {
      setEditingId(null);
      return;
    }
    try {
      await updateShelf.mutateAsync({ shelfId: shelf.id, name });
      setEditingId(null);
    } catch {
      alert("Failed to rename shelf");
    }
  }

  async function handleDelete(shelfId: number) {
    try {
      await deleteShelf.mutateAsync(shelfId);
      setConfirmDeleteId(null);
    } catch {
      alert("Failed to delete shelf");
    }
  }

  return (
    <div className="w-full px-4 sm:px-6 py-8">
      {/* Header */}
      <div className="flex items-end gap-6 mb-6" data-tour="shelves-header">
        <div>
          <p className="font-mono text-[11px] tracking-[0.12em] uppercase text-neutral-500 mb-2">
            Your library · {shelves.length}{" "}
            {shelves.length === 1 ? "shelf" : "shelves"} · {totalTitles} titles
          </p>
          <h1 className="text-4xl font-light leading-none tracking-tight text-neutral-100">
            Your{" "}
            <em className="italic text-primary-400 not-italic font-extralight">
              shelves
            </em>
          </h1>
        </div>
        <div className="flex-1" />
        <button
          onClick={handleNewShelf}
          className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white rounded-xl transition-colors"
        >
          <svg
            className="w-3.5 h-3.5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 4v16m-8-8h16"
            />
          </svg>
          New shelf
        </button>
      </div>

      {/* Free tier banner */}
      {isPremium === false && (
        <div className="mb-6 flex items-center gap-3.5 px-4 py-3.5 rounded-2xl border border-neutral-700 bg-primary-600/5 text-sm">
          <span className="w-7 h-7 rounded-lg bg-primary-600 text-white flex items-center justify-center shrink-0">
            <svg
              className="w-3.5 h-3.5"
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
          </span>
          <span className="text-neutral-400">
            <strong className="text-neutral-100 font-semibold">
              {shelves.length} of {FREE_SHELF_LIMIT} shelves used
            </strong>{" "}
            on the free plan.{" "}
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="text-primary-400 font-medium hover:text-primary-300 transition-colors"
            >
              Upgrade to Pro
            </button>{" "}
            for unlimited shelves and more.
          </span>
        </div>
      )}

      {/* Loading */}
      {isLoading && (
        <div className="flex justify-center py-20">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {/* Grid */}
      {!isLoading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {shelves.map((shelf, idx) => (
            <ShelfCard
              key={shelf.id}
              shelf={shelf}
              idx={idx}
              color={shelfColor(shelf)}
              isEditing={editingId === shelf.id}
              editName={editName}
              menuOpen={openMenuId === shelf.id}
              onEditNameChange={setEditName}
              onRename={() => handleRename(shelf)}
              onEditCancel={() => setEditingId(null)}
              onMenuOpen={(e) => {
                e.stopPropagation();
                setOpenMenuId(openMenuId === shelf.id ? null : shelf.id);
              }}
              onMenuClose={() => setOpenMenuId(null)}
              onStartRename={() => {
                setEditingId(shelf.id);
                setEditName(shelf.name);
                setOpenMenuId(null);
              }}
              onStartDelete={() => {
                setConfirmDeleteId(shelf.id);
                setOpenMenuId(null);
              }}
              onClick={() => navigate(`/shelves/${shelf.id}`)}
            />
          ))}

          {/* New shelf placeholder */}
          <button
            onClick={handleNewShelf}
            className="flex flex-col items-center justify-center gap-2.5 min-h-[240px] rounded-2xl border border-dashed border-neutral-700 bg-neutral-900 hover:border-neutral-500 hover:bg-neutral-850 transition-colors cursor-pointer"
          >
            <span className="w-11 h-11 rounded-xl bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-500">
              <svg
                className="w-5 h-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v16m-8-8h16"
                />
              </svg>
            </span>
            <span className="text-xl font-light text-neutral-300">
              New shelf
            </span>
            <span className="text-xs text-neutral-500 text-center max-w-[180px] leading-relaxed">
              Organize titles by mood, genre, or anything else
            </span>
          </button>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-semibold text-neutral-100 mb-4">
              New shelf
            </h2>
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") {
                  setShowCreate(false);
                  setNewName("");
                }
              }}
              placeholder="Shelf name…"
              className="w-full bg-neutral-700 border border-neutral-600 rounded-xl px-3 py-2.5 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-primary-500 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowCreate(false);
                  setNewName("");
                }}
                className="px-4 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!newName.trim() || createShelf.isPending}
                className="px-4 py-2 text-sm font-semibold bg-primary-600 hover:bg-primary-500 text-white rounded-xl disabled:opacity-50 transition-colors"
              >
                {createShelf.isPending ? "Creating…" : "Create"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-800 border border-neutral-700 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h2 className="text-lg font-bold text-neutral-100 mb-2">
              Delete shelf?
            </h2>
            <p className="text-sm text-neutral-400 mb-6">
              This will permanently delete the shelf and remove all its items.
              This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setConfirmDeleteId(null)}
                className="px-4 py-2 text-sm text-neutral-300 hover:text-neutral-100 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleteShelf.isPending}
                className="px-4 py-2 text-sm font-semibold bg-error-600 hover:bg-error-500 text-white rounded-xl disabled:opacity-50 transition-colors"
              >
                {deleteShelf.isPending ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showUpgradeModal && (
        <ProUpgradeModal
          onClose={() => setShowUpgradeModal(false)}
          feature="shelves"
        />
      )}
    </div>
  );
}
