import { useState } from "react";

interface StarRatingProps {
  rating: number | null;
  onRate: (rating: number | null) => void;
  saving?: boolean;
}

export default function StarRating({ rating, onRate, saving = false }: StarRatingProps) {
  const [hovered, setHovered] = useState<number | null>(null);

  const displayed = hovered ?? rating ?? 0;

  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          disabled={saving}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => onRate(rating === star ? null : star)}
          className="disabled:opacity-50 disabled:cursor-not-allowed transition-transform duration-100 hover:scale-110"
          aria-label={`Rate ${star} star${star !== 1 ? "s" : ""}`}
        >
          <svg
            className={`w-5 h-5 transition-colors duration-100 ${
              star <= displayed ? "text-yellow-400" : "text-slate-600"
            }`}
            viewBox="0 0 24 24"
            fill={star <= displayed ? "currentColor" : "none"}
            stroke="currentColor"
            strokeWidth={star <= displayed ? 0 : 1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z"
            />
          </svg>
        </button>
      ))}
      {rating !== null && (
        <span className="text-xs text-slate-400 ml-1">{rating}/5</span>
      )}
    </div>
  );
}
