type Props = {
  rating: string;
};

export default function ContentRatingBadge({ rating }: Props) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 text-caption font-medium border border-neutral-600 text-neutral-300 rounded"
      title="Content rating"
    >
      {rating}
    </span>
  );
}
