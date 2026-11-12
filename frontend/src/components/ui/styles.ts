// Class builders shared by the ui components, for the few places that need a
// control's look on an element the components don't render (a <select>, a
// router <Link>). Kept apart from the components so hot reload keeps state.

/** Joins class names, skipping empty ones. */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-400";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary-500 text-neutral-950 hover:bg-primary-400 font-semibold",
  secondary:
    "border border-neutral-700 bg-neutral-900 text-neutral-100 hover:border-neutral-500 hover:bg-neutral-850 font-medium",
  ghost: "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50 font-medium",
  danger: "border border-error-500/40 text-error-300 hover:bg-error-500/10 font-medium",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  md: "h-control px-4 text-label gap-2",
  sm: "h-control-sm px-3 text-caption gap-1.5",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md"): string {
  return cx(
    "inline-flex items-center justify-center rounded-control whitespace-nowrap transition-colors cursor-pointer",
    "disabled:cursor-not-allowed disabled:opacity-45 aria-disabled:cursor-not-allowed aria-disabled:opacity-45",
    focusRing,
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
  );
}

/** A native <select> that matches the secondary button. */
export const selectClass = cx(
  buttonClass("secondary"),
  "pr-3 [color-scheme:dark] text-left",
);

/** A quiet text link with a trailing chevron: "See all >". */
export const moreLinkClass = cx(
  "inline-flex items-center gap-1 rounded-sm text-label font-medium text-neutral-300 hover:text-neutral-50 transition-colors",
  focusRing,
);
