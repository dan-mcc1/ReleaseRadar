type Props = {
  rating: string;
};

const ratingColors: Record<string, string> = {
  G: "border-green-500 text-green-400",
  PG: "border-yellow-500 text-yellow-400",
  "PG-13": "border-orange-500 text-orange-400",
  R: "border-red-500 text-red-400",
  "NC-17": "border-red-700 text-red-500",
  NR: "border-neutral-500 text-neutral-400",
  "TV-Y": "border-green-500 text-green-400",
  "TV-Y7": "border-green-500 text-green-400",
  "TV-G": "border-green-500 text-green-400",
  "TV-PG": "border-yellow-500 text-yellow-400",
  "TV-14": "border-orange-500 text-orange-400",
  "TV-MA": "border-red-500 text-red-400",
};

export default function ContentRatingBadge({ rating }: Props) {
  const colorClass =
    ratingColors[rating] ?? "border-neutral-500 text-neutral-400";

  return (
    <span
      className={`inline-flex items-center px-2.5 py-0.5 text-xs font-bold border rounded tracking-wide ${colorClass}`}
      title="Content rating"
    >
      {rating}
    </span>
  );
}
