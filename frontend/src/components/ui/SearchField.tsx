import { useId } from "react";
import { CloseIcon, SearchIcon } from "./icons";
import { cx, focusRing } from "./styles";

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** The field's name for screen readers, e.g. "Search watched titles". */
  label: string;
  /** Defaults to the label. */
  placeholder?: string;
  className?: string;
}

/** A search box with a clear button, h-control tall. */
export default function SearchField({ value, onChange, label, placeholder, className }: Props) {
  const id = useId();
  return (
    <div className={cx("relative w-80 max-w-full", className)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchIcon className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-neutral-500 pointer-events-none" />
      <input
        id={id}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && value) {
            e.preventDefault();
            onChange("");
          }
        }}
        placeholder={placeholder ?? label}
        className="w-full h-control pl-10 pr-10 rounded-control border border-neutral-700 bg-neutral-900 text-label text-neutral-100 placeholder-neutral-500 hover:border-neutral-500 focus:border-neutral-400 focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          title="Clear search"
          className={cx(
            "absolute right-1 top-1/2 -translate-y-1/2 size-control-sm rounded-[10px] flex items-center justify-center text-neutral-500 hover:text-neutral-200 cursor-pointer",
            focusRing,
          )}
        >
          <CloseIcon className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
