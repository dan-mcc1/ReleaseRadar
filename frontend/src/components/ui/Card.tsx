import type { HTMLAttributes } from "react";
import { cx } from "./styles";

interface Props extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "aside";
  /** none for edge-to-edge content (lists, media), sm 16px, md 24px. */
  padding?: "none" | "sm" | "md";
}

const PADDING = { none: "", sm: "p-4", md: "p-6" };

/**
 * A bounded surface for content that must read as one unit: a side panel, a
 * settings group. Not a default wrapper: most groups need only spacing and a
 * SectionHeader. Never put a Card inside a Card.
 */
export default function Card({ as: Tag = "div", padding = "md", className, ...rest }: Props) {
  return (
    <Tag
      className={cx(
        "rounded-surface bg-neutral-900 border border-neutral-800",
        PADDING[padding],
        className,
      )}
      {...rest}
    />
  );
}
