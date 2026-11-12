import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./styles";

interface Common {
  /** primary: the one main action in a view. secondary: everything else
   *  (default). ghost: low-emphasis actions in toolbars. danger: destructive. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** An icon before the label, from ./icons. */
  icon?: ReactNode;
}

export interface ButtonProps extends Common, ButtonHTMLAttributes<HTMLButtonElement> {
  /** Shows a spinner and blocks clicks without dropping keyboard focus. */
  loading?: boolean;
}

export default function Button({
  variant,
  size,
  icon,
  loading = false,
  className,
  children,
  type = "button",
  onClick,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      aria-busy={loading || undefined}
      aria-disabled={loading || undefined}
      onClick={loading ? (e) => e.preventDefault() : onClick}
      className={cx(buttonClass(variant, size), className)}
      {...rest}
    >
      {loading ? (
        <span
          className="w-3.5 h-3.5 rounded-full border-2 border-current border-t-transparent animate-spin"
          aria-hidden="true"
        />
      ) : (
        icon
      )}
      {children}
    </button>
  );
}

/** A router link that looks like a Button, for actions that navigate. */
export function ButtonLink({ variant, size, icon, className, children, ...rest }: Common & LinkProps) {
  return (
    <Link className={cx(buttonClass(variant, size), className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}
