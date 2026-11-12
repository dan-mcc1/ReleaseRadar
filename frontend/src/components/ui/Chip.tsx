import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, focusRing } from "./styles";

export interface ChipProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  /** A filter chip is a toggle: pressed means the filter is on. */
  pressed: boolean;
  children: ReactNode;
  /** A small colour mark before the label, e.g. a genre's colour. */
  dot?: string;
  /** A count after the label, e.g. how many titles match. */
  count?: number;
}

/** A pill-shaped toggle for filters: genres, tags, statuses. */
export default function Chip({
  pressed,
  children,
  dot,
  count,
  className,
  type = "button",
  ...rest
}: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={cx(
        "h-control inline-flex flex-none items-center gap-2 rounded-full border px-4 text-label transition-colors cursor-pointer",
        pressed
          ? "bg-neutral-100 border-neutral-100 text-neutral-950 font-semibold"
          : "bg-neutral-900 border-neutral-700 text-neutral-300 font-medium hover:border-neutral-500 hover:text-neutral-50",
        focusRing,
        className,
      )}
      {...rest}
    >
      {dot && <span className="size-2 rounded-full" style={{ background: dot }} aria-hidden="true" />}
      {children}
      {count !== undefined && (
        <span className={cx("tabular", pressed ? "text-neutral-500" : "text-neutral-500")}>{count}</span>
      )}
    </button>
  );
}
