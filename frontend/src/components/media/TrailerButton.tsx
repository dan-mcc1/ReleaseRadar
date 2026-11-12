import { useState } from "react";
import { Modal, PlayIcon } from "../ui";

interface Props {
  trailerKey: string;
  /** "overlay" is the round button that sits on top of a backdrop image. */
  variant?: "button" | "overlay";
}

function TrailerModal({ trailerKey, onClose }: { trailerKey: string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title="Trailer" hideTitle variant="bare" size="xl">
      <div className="aspect-video rounded-xl overflow-hidden shadow-2xl">
        <iframe
          src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&rel=0`}
          title="Trailer"
          className="w-full h-full"
          allowFullScreen
          allow="autoplay; encrypted-media"
        />
      </div>
    </Modal>
  );
}

export default function TrailerButton({ trailerKey, variant = "button" }: Props) {
  const [open, setOpen] = useState(false);
  const overlay = variant === "overlay";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          overlay
            ? "inline-flex items-center gap-2.5 h-12 pl-4 pr-5 rounded-full bg-neutral-950/70 hover:bg-neutral-950/85 border border-white/25 hover:border-white/45 text-white text-sm font-semibold whitespace-nowrap backdrop-blur-sm transition-colors"
            : "inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 border border-neutral-600 text-neutral-100 text-sm font-semibold transition-colors"
        }
      >
        <PlayIcon />
        {overlay ? "Play trailer" : "Trailer"}
      </button>
      {open && <TrailerModal trailerKey={trailerKey} onClose={() => setOpen(false)} />}
    </>
  );
}
