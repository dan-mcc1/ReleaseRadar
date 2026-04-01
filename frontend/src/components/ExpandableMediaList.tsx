import { useState } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";

interface MediaItem {
  id: number;
  poster_path: string | null;
  // movies have title, shows have name
  title?: string;
  name?: string;
}

interface Props {
  items: MediaItem[];
  linkPrefix: string; // "/movie" or "/tv"
  fallbackImage: string;
  initialCount?: number;
}

export default function ExpandableMediaList({
  items,
  linkPrefix,
  fallbackImage,
  initialCount = 8,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? items : items.slice(0, initialCount);
  const hasMore = items.length > initialCount;

  if (items.length === 0) return null;

  return (
    <div>
      <div className="flex flex-wrap gap-3">
        {visible.map((item) => (
          <div key={item.id} className="flex-shrink-0 w-24">
            <Link to={`${linkPrefix}/${item.id}`}>
              <img
                src={
                  item.poster_path
                    ? `${BASE_IMAGE_URL}/w342${item.poster_path}`
                    : fallbackImage
                }
                alt={item.title ?? item.name}
                className="w-full h-auto rounded-md object-cover"
              />
              <p className="mt-1 text-xs font-medium text-slate-300 text-center leading-tight line-clamp-2">
                {item.title ?? item.name}
              </p>
            </Link>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded((e) => !e)}
          className="mt-3 text-sm text-blue-400 hover:text-blue-300"
        >
          {expanded ? "Show less" : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}
