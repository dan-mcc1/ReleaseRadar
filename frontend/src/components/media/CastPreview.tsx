// frontend/src/components/media/CastPreview.tsx
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../../constants";

interface CastMember {
  id: number;
  name: string;
  profile_path: string | null;
  character: string;
}

interface Props {
  cast: CastMember[];
  /** Opens the full cast list. */
  onSeeAll: () => void;
  /** How many people to show; 8 suits a full-width row, 6 a narrower one. */
  count?: 6 | 8;
}

/** The first few cast members on the Overview tab, with a link to the rest. */
export default function CastPreview({ cast, onSeeAll, count = 6 }: Props) {
  if (!cast?.length) return null;

  return (
    <div className="@container">
      <div className="flex items-baseline justify-between gap-3 mb-4 pb-3 border-b border-neutral-800">
        <h2 className="text-lg font-semibold tracking-tight">Cast</h2>
        {cast.length > count && (
          <button
            onClick={onSeeAll}
            className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            See all {cast.length}
          </button>
        )}
      </div>
      <div
        className={`grid gap-2 ${
          count === 8 ? "grid-cols-4 @3xl:grid-cols-8" : "grid-cols-3 @xl:grid-cols-6"
        }`}
      >
        {cast.slice(0, count).map((actor) => (
          <Link
            key={actor.id}
            to={`/person/${actor.id}`}
            className="group bg-neutral-800/60 rounded-xl overflow-hidden border border-neutral-700/50 hover:border-primary-600/50 hover:bg-neutral-700/60 transition-all duration-150"
          >
            {actor.profile_path ? (
              <img
                src={`${BASE_IMAGE_URL}/w185${actor.profile_path}`}
                alt=""
                loading="lazy"
                className="w-full aspect-[2/3] object-cover"
              />
            ) : (
              <div className="w-full aspect-[2/3] bg-neutral-700 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-neutral-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={1.5}
                    d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                  />
                </svg>
              </div>
            )}
            <div className="p-2">
              <p className="text-xs font-semibold text-white leading-tight truncate">
                {actor.name}
              </p>
              <p className="text-xs text-neutral-400 truncate mt-0.5">
                {actor.character}
              </p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
