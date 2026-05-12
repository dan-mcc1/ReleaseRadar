import { useState } from "react";
import { createPortal } from "react-dom";
import type { MediaVideo } from "../../types/media";

const TYPE_ORDER: Record<string, number> = {
  Trailer: 0,
  Teaser: 1,
  Clip: 2,
  Featurette: 3,
  "Behind the Scenes": 4,
  Bloopers: 5,
};

function sortVideos(videos: MediaVideo[]): MediaVideo[] {
  return [...videos].sort((a, b) => {
    const aOrder = TYPE_ORDER[a.type] ?? 99;
    const bOrder = TYPE_ORDER[b.type] ?? 99;
    if (aOrder !== bOrder) return aOrder - bOrder;
    if (a.official !== b.official) return a.official ? -1 : 1;
    return 0;
  });
}

function VideoModal({ video, onClose }: { video: MediaVideo; onClose: () => void }) {
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="relative w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
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
            src={`https://www.youtube.com/embed/${video.key}?autoplay=1&rel=0`}
            title={video.name}
            className="w-full h-full"
            allowFullScreen
            allow="autoplay; encrypted-media"
          />
        </div>
        <p className="mt-3 text-sm text-neutral-300 text-center truncate">{video.name}</p>
      </div>
    </div>,
    document.body,
  );
}

function VideoThumbnail({ video, onClick }: { video: MediaVideo; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex-shrink-0 w-52 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-xl"
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-neutral-800">
        <img
          src={`https://img.youtube.com/vi/${video.key}/mqdefault.jpg`}
          alt={video.name}
          className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-105"
          loading="lazy"
        />
        <div className="absolute inset-0 bg-black/30 group-hover:bg-black/10 transition-colors flex items-center justify-center">
          <div className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center group-hover:bg-primary-600 transition-colors">
            <svg className="w-5 h-5 text-white translate-x-0.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
        </div>
        <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-xs font-medium bg-black/70 text-neutral-300">
          {video.type}
        </span>
      </div>
      <p className="mt-1.5 text-xs text-neutral-400 truncate px-0.5 group-hover:text-neutral-200 transition-colors">
        {video.name}
      </p>
    </button>
  );
}

interface Props {
  videos: MediaVideo[] | undefined;
}

export default function VideoGallery({ videos }: Props) {
  const [active, setActive] = useState<MediaVideo | null>(null);
  const [expanded, setExpanded] = useState(false);

  const ytVideos = sortVideos(
    (videos ?? []).filter((v) => v.site === "YouTube"),
  );

  if (ytVideos.length < 2) return null;

  // Bar: all trailers + first 2 teasers
  const barVideos = [
    ...ytVideos.filter((v) => v.type === "Trailer"),
    ...ytVideos.filter((v) => v.type === "Teaser").slice(0, 2),
  ];
  const overflowVideos = ytVideos.filter((v) => !barVideos.includes(v));

  return (
    <div>
      <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-3">
        Videos
      </h2>

      {/* Main scrolling bar */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scrollbar-thin scrollbar-track-transparent scrollbar-thumb-neutral-700">
        {barVideos.map((v) => (
          <VideoThumbnail key={v.id} video={v} onClick={() => setActive(v)} />
        ))}

        {/* "+ N more" card — only when not expanded */}
        {overflowVideos.length > 0 && !expanded && (
          <button
            onClick={() => setExpanded(true)}
            className="group flex-shrink-0 w-52 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded-xl"
          >
            <div className="relative aspect-video rounded-xl overflow-hidden bg-neutral-800 border border-neutral-700 hover:border-primary-600/50 transition-colors flex flex-col items-center justify-center gap-1.5">
              <div className="w-10 h-10 rounded-full bg-neutral-700 group-hover:bg-primary-600/20 flex items-center justify-center transition-colors">
                <svg className="w-5 h-5 text-neutral-400 group-hover:text-primary-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
              </div>
              <span className="text-sm font-semibold text-neutral-300 group-hover:text-white transition-colors">
                {overflowVideos.length} more
              </span>
            </div>
            <p className="mt-1.5 text-xs text-neutral-500 px-0.5">Clips, featurettes &amp; more</p>
          </button>
        )}
      </div>

      {/* Expanded overflow grid */}
      {expanded && overflowVideos.length > 0 && (
        <div className="mt-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
            {overflowVideos.map((v) => (
              <VideoThumbnail key={v.id} video={v} onClick={() => setActive(v)} />
            ))}
          </div>
          <button
            onClick={() => setExpanded(false)}
            className="mt-3 text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
          >
            Show less
          </button>
        </div>
      )}

      {active && <VideoModal video={active} onClose={() => setActive(null)} />}
    </div>
  );
}
