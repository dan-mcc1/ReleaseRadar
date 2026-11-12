// frontend/src/components/media/MoreActionsMenu.tsx
import { useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import AddToGroupModal from "../AddToGroupModal";
import ProUpgradeModal from "../ProUpgradeModal";
import { RecommendModal } from "../RecommendButton";
import { ShelfPicker } from "../ShelfButton";
import { useItemShelves } from "../../hooks/api/useShelves";
import { useSubscription } from "../../hooks/api/useSubscription";
import { isPremiumFeature } from "../../config/features";

interface Props {
  contentType: "movie" | "tv";
  contentId: number;
  title: string;
}

type Dialog = "group" | "recommend" | "upgrade" | null;

const rowClass =
  "flex items-center gap-3 w-full text-left px-4 py-3 text-sm text-neutral-200 hover:bg-neutral-700 transition-colors";

function Icon({ d, className = "w-4 h-4" }: { d: string; className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
      aria-hidden="true"
    >
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

const SHELF_PATH = "M19 3H5a2 2 0 00-2 2v16l7-3.5L17 21V5a2 2 0 00-2-2z";
const GROUP_PATH =
  "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z";
const SHARE_PATH =
  "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z";

/**
 * The less-used actions on a movie or show page (shelves, groups, recommend)
 * behind one "more" button, so the bar keeps to status and favourite.
 */
export default function MoreActionsMenu({ contentType, contentId, title }: Props) {
  const { isPremium } = useSubscription();
  const shelvesGated = isPremiumFeature("shelves") && !isPremium;
  const { data: itemShelfIds = [] } = useItemShelves(contentType, contentId);
  const shelfCount = itemShelfIds.length;

  const [view, setView] = useState<"actions" | "shelves">("actions");
  const [dialog, setDialog] = useState<Dialog>(null);

  return (
    <>
      <Popover className="relative">
        <PopoverButton
          aria-label="More actions"
          title="More actions"
          onClick={() => setView("actions")}
          className="inline-flex items-center justify-center w-[38px] h-[38px] rounded-xl border border-neutral-600 bg-neutral-800 hover:bg-neutral-700 data-open:bg-neutral-700 text-neutral-300 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="1.8" />
            <circle cx="12" cy="12" r="1.8" />
            <circle cx="19" cy="12" r="1.8" />
          </svg>
        </PopoverButton>

        <PopoverPanel className="absolute top-full mt-2 right-0 sm:right-auto sm:left-0 w-60 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden">
          {({ close }) =>
            view === "shelves" ? (
              <>
                <button
                  onClick={() => setView("actions")}
                  className="flex items-center gap-2 w-full text-left px-4 py-3 text-sm font-semibold text-neutral-100 hover:bg-neutral-700 border-b border-neutral-700 transition-colors"
                >
                  <Icon d="M15 19l-7-7 7-7" className="w-3.5 h-3.5 text-neutral-400" />
                  Shelves
                </button>
                <ShelfPicker
                  contentType={contentType}
                  contentId={contentId}
                  onUpgradeRequired={() => {
                    close();
                    setDialog("upgrade");
                  }}
                />
              </>
            ) : (
              <>
                <button
                  onClick={() => {
                    if (shelvesGated) {
                      close();
                      setDialog("upgrade");
                      return;
                    }
                    setView("shelves");
                  }}
                  className={rowClass}
                >
                  <span className={shelfCount > 0 ? "text-sky-400" : "text-neutral-400"}>
                    <Icon d={SHELF_PATH} />
                  </span>
                  <span className="flex-1">
                    {shelfCount > 0 ? `Shelves (${shelfCount})` : "Add to shelf"}
                  </span>
                  <Icon d="M9 5l7 7-7 7" className="w-3.5 h-3.5 text-neutral-500" />
                </button>
                <button
                  onClick={() => {
                    close();
                    setDialog("group");
                  }}
                  className={rowClass}
                >
                  <span className="text-neutral-400">
                    <Icon d={GROUP_PATH} />
                  </span>
                  Add to group
                </button>
                <button
                  onClick={() => {
                    close();
                    setDialog("recommend");
                  }}
                  className={rowClass}
                >
                  <span className="text-neutral-400">
                    <Icon d={SHARE_PATH} />
                  </span>
                  Recommend to a friend
                </button>
              </>
            )
          }
        </PopoverPanel>
      </Popover>

      {dialog === "group" && (
        <AddToGroupModal
          contentType={contentType}
          contentId={contentId}
          title={title}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "recommend" && (
        <RecommendModal
          contentType={contentType}
          contentId={contentId}
          contentTitle={title}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === "upgrade" && (
        <ProUpgradeModal feature="shelves" onClose={() => setDialog(null)} />
      )}
    </>
  );
}
