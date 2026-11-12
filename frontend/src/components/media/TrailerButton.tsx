import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

interface Props {
  trailerKey: string;
  /** "overlay" is the round button that sits on top of a backdrop image. */
  variant?: "button" | "overlay";
}

function TrailerModal({ trailerKey, onClose }: { trailerKey: string; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={onClose}
          className="absolute -top-10 right-0 text-neutral-400 hover:text-white transition-colors flex items-center gap-1.5 text-sm"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
          Close
        </button>
        <div className="aspect-video rounded-xl overflow-hidden shadow-2xl">
          <iframe
            src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&rel=0`}
            title="Trailer"
            className="w-full h-full"
            allowFullScreen
            allow="autoplay; encrypted-media"
          />
        </div>
      </div>
    </div>,
    document.body,
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
            : "inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-error-600 hover:bg-error-500 text-white text-sm font-semibold transition-colors"
        }
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
        {overlay ? "Play trailer" : "Trailer"}
      </button>
      {open && <TrailerModal trailerKey={trailerKey} onClose={() => setOpen(false)} />}
    </>
  );
}
