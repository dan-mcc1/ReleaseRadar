import { useState } from "react";
import StarIcon from "./icons/StarIcon";

interface StarRatingProps {
  rating: number | null;
  onRate: (rating: number | null) => void;
  saving?: boolean;
}

export default function StarRating({
  rating,
  onRate,
  saving = false,
}: StarRatingProps) {
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
          <StarIcon
            filled={star <= displayed}
            className={`w-5 h-5 transition-colors duration-100 ${
              star <= displayed ? "text-yellow-400" : "text-neutral-600"
            }`}
          />
        </button>
      ))}
      {rating !== null && (
        <span className="text-xs text-neutral-400 ml-1">{rating}/5</span>
      )}
    </div>
  );
}
