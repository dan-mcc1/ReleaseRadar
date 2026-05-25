import { useState } from "react";
import AddToGroupModal from "./AddToGroupModal";

interface Props {
  contentType: "movie" | "tv";
  contentId: number;
  title: string;
}

export default function AddToGroupButton({ contentType, contentId, title }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Add to a group"
        className="flex items-center gap-1.5 text-sm font-medium text-neutral-300 hover:text-white bg-neutral-800/80 hover:bg-neutral-700 border border-neutral-700 px-3 py-2 rounded-xl transition-colors"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
        </svg>
        Add to group
      </button>
      {open && (
        <AddToGroupModal
          contentType={contentType}
          contentId={contentId}
          title={title}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
