import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  EllipsisHorizontalIcon,
  PencilIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import {
  useShelves,
  useCreateShelf,
  useDeleteShelf,
  useUpdateShelf,
  type Shelf,
} from "../hooks/api/useShelves";
import { usePageTitle } from "../hooks/usePageTitle";
import { CHECKOUT_ENABLED } from "../config/features";
import { useUserMe } from "../hooks/api/useUser";
import ProUpgradeModal from "../components/ProUpgradeModal";
import { BASE_IMAGE_URL } from "../constants";
import { useToast } from "../components/Toast";
import {
  BookmarkIcon,
  Button,
  IconButton,
  PageHeader,
  PlusIcon,
} from "../components/ui";

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
      className="relative flex flex-col gap-3.5 p-5 rounded-surface bg-neutral-800 border border-neutral-700 hover:border-neutral-600 transition-colors overflow-hidden cursor-pointer"
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
              className="text-title bg-neutral-700 border border-neutral-600 rounded-control px-2 py-1 text-neutral-100 outline-none focus:border-primary-500 w-full"
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <h3 className="text-heading font-semibold leading-tight text-neutral-100 truncate">
              {shelf.name}
            </h3>
          )}
          {shelf.description && !isEditing && (
            <p className="text-label text-neutral-400 mt-1 leading-snug line-clamp-2">
              {shelf.description}
            </p>
          )}
        </div>

        {/* 3-dot menu */}
        <div className="relative shrink-0 ml-2" ref={menuRef}>
          <IconButton
            label="Shelf options"
            icon={<EllipsisHorizontalIcon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />}
            size="sm"
            onClick={onMenuOpen}
            aria-expanded={menuOpen}
          />
          {menuOpen && (
            <div className="absolute right-0 top-9 z-20 bg-neutral-800 border border-neutral-700 rounded-control shadow-2xl py-1 min-w-[120px]">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartRename();
                }}
                className="w-full text-left px-3 py-2 text-label text-neutral-300 hover:bg-neutral-700 transition-colors flex items-center gap-2"
              >
                <PencilIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                Rename
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStartDelete();
                }}
                className="w-full text-left px-3 py-2 text-label text-error-400 hover:bg-neutral-700 transition-colors flex items-center gap-2"
              >
                <TrashIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                Delete
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Poster stack + count */}
      <div className="flex items-end pl-2 mt-1">
        <div className="flex">
          {shelf.preview_posters.length > 0 ? (
            shelf.preview_posters.slice(0, 4).map((poster, i) => (
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
          ) : (
            <div
              className="rounded-md bg-neutral-700 border border-neutral-600 flex items-center justify-center"
              style={{ width: 52, height: 78 }}
            >
              <BookmarkIcon className="w-5 h-5 text-neutral-600" />
            </div>
          )}
        </div>
        <div className="flex-1" />
        <p className="text-label text-neutral-400 tabular">
          {shelf.item_count} {shelf.item_count === 1 ? "title" : "titles"}
        </p>
      </div>
    </div>
  );
}

export default function ShelvesPage() {
  usePageTitle("Shelves");
  const navigate = useNavigate();
  const toast = useToast();
  const { data: shelves = [], isLoading } = useShelves();
  const { data: userMe } = useUserMe();
  const createShelf = useCreateShelf();
  const deleteShelf = useDeleteShelf();
  const updateShelf = useUpdateShelf();

  const isPremium = userMe == null ? null : userMe.subscription_tier !== "free";
  const FREE_SHELF_LIMIT = 3;
  const atFreeLimit = false; // open beta: no shelf limit enforced
  // const atFreeLimit = isPremium === false && shelves.length >= FREE_SHELF_LIMIT;
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
      toast.error("Failed to create shelf");
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
      toast.error("Failed to rename shelf");
    }
  }

  async function handleDelete(shelfId: number) {
    try {
      await deleteShelf.mutateAsync(shelfId);
      setConfirmDeleteId(null);
    } catch {
      toast.error("Failed to delete shelf");
    }
  }

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-6">
      <div data-tour="shelves-header">
        <PageHeader
          title="Your shelves"
          description={`${shelves.length} ${shelves.length === 1 ? "shelf" : "shelves"} · ${totalTitles} ${totalTitles === 1 ? "title" : "titles"}`}
          actions={
            <Button variant="primary" icon={<PlusIcon />} onClick={handleNewShelf}>
              New shelf
            </Button>
          }
        />
      </div>

      {/* Free tier banner — shown once the paywall launches */}
      {CHECKOUT_ENABLED && isPremium === false && (
        <div className="flex items-center gap-3.5 px-4 py-3.5 rounded-surface border border-neutral-700 text-body">
          <BookmarkIcon className="w-5 h-5 text-neutral-400 shrink-0" />
          <span className="text-neutral-400">
            <strong className="text-neutral-100 font-semibold">
              {shelves.length} of {FREE_SHELF_LIMIT} shelves used
            </strong>{" "}
            on the free plan.{" "}
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="text-neutral-100 font-medium underline hover:text-primary-300 transition-colors cursor-pointer"
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
          {shelves.map((shelf) => (
            <ShelfCard
              key={shelf.id}
              shelf={shelf}
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
            className="flex flex-col items-center justify-center gap-2.5 min-h-[240px] rounded-surface border border-dashed border-neutral-700 bg-neutral-900 hover:border-neutral-500 hover:bg-neutral-850 transition-colors cursor-pointer"
          >
            <span className="w-11 h-11 rounded-control bg-neutral-800 border border-neutral-700 flex items-center justify-center text-neutral-500">
              <PlusIcon className="w-5 h-5" />
            </span>
            <span className="text-title font-medium text-neutral-300">
              New shelf
            </span>
            <span className="text-caption text-neutral-400 text-center max-w-[180px] leading-relaxed">
              Organize titles by mood, genre, or anything else
            </span>
          </button>
        </div>
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-800 border border-neutral-700 rounded-surface p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h2 className="text-title font-semibold text-neutral-100 mb-4">
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
              className="w-full bg-neutral-700 border border-neutral-600 rounded-control px-3 py-2.5 text-body text-neutral-100 placeholder-neutral-500 outline-none focus:border-primary-500 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowCreate(false);
                  setNewName("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                onClick={handleCreate}
                disabled={!newName.trim() || createShelf.isPending}
              >
                {createShelf.isPending ? "Creating…" : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {confirmDeleteId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-neutral-800 border border-neutral-700 rounded-surface p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h2 className="text-title font-semibold text-neutral-100 mb-2">
              Delete shelf?
            </h2>
            <p className="text-body text-neutral-400 mb-6">
              This will permanently delete the shelf and remove all its items.
              This cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <Button variant="ghost" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => handleDelete(confirmDeleteId)}
                disabled={deleteShelf.isPending}
              >
                {deleteShelf.isPending ? "Deleting…" : "Delete"}
              </Button>
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
