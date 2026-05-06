// frontend/src/components/media/RecommendationsGrid.tsx
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../../constants";

interface RecommendationItem {
  id: number;
  poster_path?: string | null;
  title?: string;
  name?: string;
}

interface Props {
  items: RecommendationItem[];
  linkPrefix: "/movie" | "/tv";
}

export default function RecommendationsGrid({ items, linkPrefix }: Props) {
  if (!items.length) return null;
  return (
    <div>
      <h2 className="text-xl font-semibold text-neutral-100 mb-4">You Might Also Like</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {items.slice(0, 12).map((rec) => {
          const label = rec.title ?? rec.name ?? "";
          return (
            <Link key={rec.id} to={`${linkPrefix}/${rec.id}`} className="group">
              {rec.poster_path ? (
                <img
                  src={`${BASE_IMAGE_URL}/w342${rec.poster_path}`}
                  alt={label}
                  className="w-full rounded-lg object-cover border border-neutral-700 group-hover:border-neutral-500 transition-all duration-200 group-hover:scale-105"
                />
              ) : (
                <div className="w-full aspect-[2/3] bg-neutral-800 border border-neutral-700 rounded-lg flex items-center justify-center">
                  <span className="text-neutral-500 text-xs text-center px-1">{label}</span>
                </div>
              )}
              <p className="text-xs mt-1.5 text-neutral-400 group-hover:text-neutral-200 transition-colors text-center line-clamp-1">
                {label}
              </p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
