// frontend/src/components/media/MediaActionList.tsx
import { useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { ShareIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { BookmarkIcon, ChevronDownIcon } from "../ui";
import AddToGroupModal from "../AddToGroupModal";
import FavoriteButton from "../FavoriteButton";
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

// Boxed buttons in a 2-column grid on small screens; plain rows in the side panel from lg up.
const rowClass =
  "flex items-center gap-3 w-full min-h-11 lg:min-h-10 px-3 lg:px-2 rounded-xl lg:rounded-lg border border-neutral-800 lg:border-transparent bg-neutral-900 lg:bg-transparent hover:bg-neutral-800 text-sm text-neutral-200 hover:text-white text-left transition-colors disabled:opacity-60";

/**
 * Favourite, shelves, groups and recommend as a labelled list, for the side
 * panel of a movie or show page.
 */
export default function MediaActionList({ contentType, contentId, title }: Props) {
  const { isPremium } = useSubscription();
  const shelvesGated = isPremiumFeature("shelves") && !isPremium;
  const { data: itemShelfIds = [] } = useItemShelves(contentType, contentId);
  const shelfCount = itemShelfIds.length;

  const [dialog, setDialog] = useState<Dialog>(null);

  const shelfRow = (
    <>
      <BookmarkIcon
        className={`w-4 h-4 shrink-0 ${shelfCount > 0 ? "text-info-400" : "text-neutral-400"}`}
      />
      <span className="flex-1">
        {shelfCount > 0 ? `Shelves (${shelfCount})` : "Add to shelf"}
      </span>
      <ChevronDownIcon className="w-3.5 h-3.5 shrink-0 text-neutral-500" />
    </>
  );

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-1 gap-2 lg:gap-0.5">
        <FavoriteButton
          contentType={contentType}
          contentId={contentId}
          variant="row"
          className={rowClass}
        />

        {shelvesGated ? (
          <button onClick={() => setDialog("upgrade")} className={rowClass}>
            {shelfRow}
          </button>
        ) : (
          <Popover className="relative">
            <PopoverButton className={rowClass}>{shelfRow}</PopoverButton>
            <PopoverPanel className="absolute top-full mt-1 right-0 lg:right-auto lg:left-0 w-60 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden">
              {({ close }) => (
                <ShelfPicker
                  contentType={contentType}
                  contentId={contentId}
                  onUpgradeRequired={() => {
                    close();
                    setDialog("upgrade");
                  }}
                />
              )}
            </PopoverPanel>
          </Popover>
        )}

        <button onClick={() => setDialog("group")} className={rowClass}>
          <UserPlusIcon className="w-4 h-4 shrink-0 text-neutral-400" strokeWidth={2} aria-hidden="true" />
          Add to group
        </button>

        <button onClick={() => setDialog("recommend")} className={rowClass}>
          <ShareIcon className="w-4 h-4 shrink-0 text-neutral-400" strokeWidth={2} aria-hidden="true" />
          Recommend
        </button>
      </div>

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
