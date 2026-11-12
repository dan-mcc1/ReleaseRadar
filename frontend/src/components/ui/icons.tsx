// The app's interface icons: Heroicons (already the nav's icon set), 24px
// outline at its standard stroke, solid where a filled state means "on".
// Use these instead of pasting <svg> paths or unicode glyphs (→ ★ ✓ ✕) into
// components. They're decorative; the control holding one carries the label.
import {
  BookmarkIcon as BookmarkOutline,
  CheckIcon as CheckOutline,
  ChevronDownIcon as ChevronDownOutline,
  ChevronLeftIcon as ChevronLeftOutline,
  ChevronRightIcon as ChevronRightOutline,
  FunnelIcon as FunnelOutline,
  MagnifyingGlassIcon as SearchOutline,
  PlusIcon as PlusOutline,
  StarIcon as StarOutline,
  XMarkIcon as CloseOutline,
} from "@heroicons/react/24/outline";
import {
  BookmarkIcon as BookmarkSolid,
  PlayIcon as PlaySolid,
  StarIcon as StarSolid,
} from "@heroicons/react/24/solid";

interface IconProps {
  className?: string;
}

const SIZE = "w-4 h-4";

// Strokes stay legible at 16px: Heroicons' 1.5 is drawn for 24.
const STROKE = 2;

export function CheckIcon({ className = SIZE }: IconProps) {
  return <CheckOutline className={className} strokeWidth={STROKE} aria-hidden="true" />;
}

export function PlusIcon({ className = SIZE }: IconProps) {
  return <PlusOutline className={className} strokeWidth={STROKE} aria-hidden="true" />;
}

export function CloseIcon({ className = SIZE }: IconProps) {
  return <CloseOutline className={className} strokeWidth={STROKE} aria-hidden="true" />;
}

export function ChevronLeftIcon({ className = SIZE }: IconProps) {
  return <ChevronLeftOutline className={className} strokeWidth={STROKE} aria-hidden="true" />;
}

export function ChevronRightIcon({ className = SIZE }: IconProps) {
  return <ChevronRightOutline className={className} strokeWidth={STROKE} aria-hidden="true" />;
}

export function ChevronDownIcon({ className = SIZE }: IconProps) {
  return <ChevronDownOutline className={className} strokeWidth={STROKE} aria-hidden="true" />;
}

export function SearchIcon({ className = SIZE }: IconProps) {
  return <SearchOutline className={className} strokeWidth={STROKE} aria-hidden="true" />;
}

export function FilterIcon({ className = SIZE }: IconProps) {
  return <FunnelOutline className={className} strokeWidth={STROKE} aria-hidden="true" />;
}

export function BookmarkIcon({ filled = false, className = SIZE }: IconProps & { filled?: boolean }) {
  return filled ? (
    <BookmarkSolid className={className} aria-hidden="true" />
  ) : (
    <BookmarkOutline className={className} strokeWidth={STROKE} aria-hidden="true" />
  );
}

export function PlayIcon({ className = SIZE }: IconProps) {
  return <PlaySolid className={className} aria-hidden="true" />;
}

export function StarIcon({ filled = true, className = SIZE }: IconProps & { filled?: boolean }) {
  return filled ? (
    <StarSolid className={className} aria-hidden="true" />
  ) : (
    <StarOutline className={className} strokeWidth={STROKE} aria-hidden="true" />
  );
}
