import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cx, focusRing } from "./styles";

type Variant = "ghost" | "secondary" | "overlay";
type Size = "sm" | "md" | "touch";

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> {
  /** What the button does, e.g. "Mark Severance watched". Read by screen
   *  readers and shown as the tooltip. */
  label: string;
  icon: ReactNode;
  /** ghost: in toolbars (default). secondary: bordered, beside other
   *  controls. overlay: laid over posters and artwork. */
  variant?: Variant;
  /** sm 32px, md 40px (default), touch 44px: use touch over imagery. */
  size?: Size;
  /** For toggles: sets aria-pressed and the filled "on" look. */
  pressed?: boolean;
  /** Round (default) or the control radius. */
  shape?: "round" | "square";
}

const SIZES: Record<Size, string> = {
  sm: "size-control-sm",
  md: "size-control",
  touch: "size-touch",
};

const VARIANTS: Record<Variant, string> = {
  ghost: "text-neutral-300 hover:bg-neutral-800 hover:text-neutral-50",
  secondary:
    "border border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-500 hover:text-neutral-50",
  overlay:
    "border border-white/25 bg-neutral-950/80 text-neutral-100 backdrop-blur-sm hover:border-primary-400 hover:text-primary-300",
};

const PRESSED = "bg-primary-500 border border-primary-500 text-neutral-950 hover:bg-primary-400";

export default function IconButton({
  label,
  icon,
  variant = "ghost",
  size = "md",
  pressed,
  shape = "round",
  className,
  type = "button",
  title,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      aria-pressed={pressed}
      title={title ?? label}
      className={cx(
        "inline-flex flex-none items-center justify-center transition-colors cursor-pointer",
        "disabled:cursor-not-allowed disabled:opacity-45",
        shape === "round" ? "rounded-full" : "rounded-control",
        SIZES[size],
        pressed ? PRESSED : VARIANTS[variant],
        focusRing,
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
