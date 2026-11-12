// frontend/src/components/media/MediaActionList.tsx
import { useState } from "react";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
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

function Icon({ d, className }: { d: string; className: string }) {
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
      <Icon
        d={SHELF_PATH}
        className={`w-4 h-4 shrink-0 ${shelfCount > 0 ? "text-sky-400" : "text-neutral-400"}`}
      />
      <span className="flex-1">
        {shelfCount > 0 ? `Shelves (${shelfCount})` : "Add to shelf"}
      </span>
      <Icon d="M19 9l-7 7-7-7" className="w-3.5 h-3.5 shrink-0 text-neutral-500" />
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
          <Icon d={GROUP_PATH} className="w-4 h-4 shrink-0 text-neutral-400" />
          Add to group
        </button>

        <button onClick={() => setDialog("recommend")} className={rowClass}>
          <Icon d={SHARE_PATH} className="w-4 h-4 shrink-0 text-neutral-400" />
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
