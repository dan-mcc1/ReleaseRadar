// frontend/src/components/media/MoreActionsMenu.tsx
import { useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { EllipsisHorizontalIcon, ShareIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { BookmarkIcon, ChevronLeftIcon, ChevronRightIcon } from "../ui";
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
          <EllipsisHorizontalIcon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
        </PopoverButton>

        <PopoverPanel className="absolute top-full mt-2 right-0 sm:right-auto sm:left-0 w-60 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden">
          {({ close }) =>
            view === "shelves" ? (
              <>
                <button
                  onClick={() => setView("actions")}
                  className="flex items-center gap-2 w-full text-left px-4 py-3 text-sm font-semibold text-neutral-100 hover:bg-neutral-700 border-b border-neutral-700 transition-colors"
                >
                  <ChevronLeftIcon className="w-3.5 h-3.5 text-neutral-400" />
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
                  <span className={shelfCount > 0 ? "text-info-400" : "text-neutral-400"}>
                    <BookmarkIcon />
                  </span>
                  <span className="flex-1">
                    {shelfCount > 0 ? `Shelves (${shelfCount})` : "Add to shelf"}
                  </span>
                  <ChevronRightIcon className="w-3.5 h-3.5 text-neutral-500" />
                </button>
                <button
                  onClick={() => {
                    close();
                    setDialog("group");
                  }}
                  className={rowClass}
                >
                  <span className="text-neutral-400">
                    <UserPlusIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
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
                    <ShareIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
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
