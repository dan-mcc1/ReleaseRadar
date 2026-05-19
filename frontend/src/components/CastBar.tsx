import { BASE_IMAGE_URL } from "../constants";
import { Link } from "react-router-dom";

interface CastBarProps {
  cast: Cast[];
}

type Cast = {
  id: number;
  name: string;
  profile_path: string | null;
  character: string;
};

export default function CastBar({ cast }: CastBarProps) {
  if (!cast?.length) return null;

  return (
    <div>
      <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-4">
        Cast
      </h2>
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-10 gap-2">
        {cast.map((actor) => (
          <Link
            key={actor.id}
            to={`/person/${actor.id}`}
            className="group bg-neutral-800/60 rounded-xl overflow-hidden border border-neutral-700/50 hover:border-primary-600/50 hover:bg-neutral-700/60 transition-all duration-150"
          >
            {actor.profile_path ? (
              <img
                src={`${BASE_IMAGE_URL}/original${actor.profile_path}`}
                alt={actor.name}
                className="w-full aspect-[2/3] object-cover"
              />
            ) : (
              <div className="w-full aspect-[2/3] bg-neutral-700 flex items-center justify-center">
                <svg
                  className="w-8 h-8 text-neutral-500"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
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
