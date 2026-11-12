import { StarIcon } from "./icons";
import { cx } from "./styles";

interface Props {
  /** TMDb's 0-10 average. Nothing renders for 0 or missing. */
  value: number | null | undefined;
  className?: string;
}

/** A title's TMDb rating, "★ 7.4", for subtitles and facts. */
export default function Rating({ value, className }: Props) {
  if (!value) return null;
  const text = value.toFixed(1);
  return (
    <span
      className={cx("inline-flex items-center gap-1 tabular", className)}
      aria-label={`Rated ${text} out of 10`}
    >
      <StarIcon className="w-3 h-3 text-warning-400" />
      <span aria-hidden="true">{text}</span>
    </span>
  );
}
