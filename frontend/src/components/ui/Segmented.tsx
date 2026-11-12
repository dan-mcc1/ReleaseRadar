import type { ReactNode } from "react";
import { cx, focusRing } from "./styles";

interface Props<T extends string> {
  /** Names the group for screen readers, e.g. "Type". */
  label: string;
  value: T;
  options: { value: T; label: ReactNode }[];
  onChange: (value: T) => void;
  className?: string;
}

/** A row of mutually exclusive choices, one always pressed. h-control tall. */
export default function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: Props<T>) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cx(
        "h-control inline-flex flex-none p-0.5 bg-neutral-900 border border-neutral-800 rounded-control",
        className,
      )}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "px-3.5 rounded-[10px] text-label font-medium whitespace-nowrap transition-colors cursor-pointer",
            value === o.value ? "bg-neutral-700 text-neutral-50" : "text-neutral-400 hover:text-neutral-100",
            focusRing,
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
