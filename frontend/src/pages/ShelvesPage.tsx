import { useState, useEffect } from "react";
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
import { isPremiumFeature } from "../config/features";
import ProUpgradeModal from "../components/ProUpgradeModal";

export default function ShelvesPage() {
  usePageTitle("Shelves");
  const navigate = useNavigate();
  const { data: shelves = [], isLoading } = useShelves();
  const { data: userMe } = useUserMe();
  const createShelf = useCreateShelf();
  const deleteShelf = useDeleteShelf();
  const updateShelf = useUpdateShelf();

  const isPremium = userMe == null ? null : userMe.subscription_tier !== "free";
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);

  const [newName, setNewName] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  useEffect(() => {
    if (isPremiumFeature("shelves") && isPremium === false)
      setShowUpgradeModal(true);
  }, [isPremium]);

  async function handleCreate() {
    if (isPremiumFeature("shelves") && !isPremium) {
      setShowUpgradeModal(true);
      return;
    }
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
    <div className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div
        className="flex items-center justify-between"
        data-tour="shelves-header"
      >
        <h1 className="text-2xl font-bold text-neutral-100">My Shelves</h1>
        {!showCreate && (
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-xl transition-colors"
          >
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
                d="M12 4v16m-8-8h16"
              />
            </svg>
            New Shelf
          </button>
        )}
      </div>

      {showCreate && (
        <div className="flex gap-2 p-4 bg-neutral-800 border border-neutral-700 rounded-xl">
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
            className="flex-1 bg-neutral-700 border border-neutral-600 rounded-lg px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 outline-none focus:border-sky-500"
          />
          <button
            onClick={handleCreate}
            disabled={!newName.trim() || createShelf.isPending}
            className="px-4 py-2 text-sm font-semibold bg-sky-600 hover:bg-sky-500 text-white rounded-lg disabled:opacity-50 transition-colors"
          >
            Create
          </button>
          <button
            onClick={() => {
              setShowCreate(false);
              setNewName("");
            }}
            className="px-3 py-2 text-sm text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            Cancel
          </button>
        </div>
      )}

      {isLoading && (
        <div className="flex justify-center py-12">
          <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {!isLoading && shelves.length === 0 && (
        <div className="text-center py-16 text-neutral-400">
          <svg
            className="w-12 h-12 mx-auto mb-4 opacity-30"
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
          <p className="text-sm">No shelves yet. Create one to get started.</p>
        </div>
      )}

      <div className="space-y-2">
        {shelves.map((shelf) => (
          <div
            key={shelf.id}
            className="flex items-center gap-3 p-4 bg-neutral-800 border border-neutral-700 rounded-xl hover:border-neutral-600 transition-colors group"
          >
            {editingId === shelf.id ? (
              <input
                autoFocus
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRename(shelf);
                  if (e.key === "Escape") setEditingId(null);
                }}
                onBlur={() => handleRename(shelf)}
                className="flex-1 bg-neutral-700 border border-neutral-600 rounded-lg px-3 py-1.5 text-sm text-neutral-100 outline-none focus:border-sky-500"
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <button
                onClick={() => navigate(`/shelves/${shelf.id}`)}
                className="flex-1 text-left"
              >
                <span className="font-semibold text-neutral-100">
                  {shelf.name}
                </span>
                {shelf.description && (
                  <span className="ml-2 text-sm text-neutral-400">
                    {shelf.description}
                  </span>
                )}
                <span className="ml-2 text-xs text-neutral-500">
                  {shelf.item_count} {shelf.item_count === 1 ? "item" : "items"}
                </span>
              </button>
            )}

            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingId(shelf.id);
                  setEditName(shelf.name);
                }}
                className="p-1.5 text-neutral-400 hover:text-neutral-200 rounded-lg hover:bg-neutral-700 transition-colors"
                title="Rename"
              >
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
                    d="M15.232 5.232l3.536 3.536M9 13l6.586-6.586a2 2 0 012.828 2.828L11.828 15.828a2 2 0 01-1.414.586H9v-2a2 2 0 01.586-1.414z"
                  />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setConfirmDeleteId(shelf.id);
                }}
                className="p-1.5 text-neutral-400 hover:text-error-400 rounded-lg hover:bg-error-600/10 transition-colors"
                title="Delete"
              >
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
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M1 7h22M8 7V5a2 2 0 012-2h4a2 2 0 012 2v2"
                  />
                </svg>
              </button>
            </div>
          </div>
        ))}
      </div>

      {showUpgradeModal && (
        <ProUpgradeModal
          onClose={() => setShowUpgradeModal(false)}
          feature="shelves"
          navigateBackOnClose
        />
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
    </div>
  );
}
