import type { ReactNode } from "react";
import { cx } from "./styles";

interface Props {
  title: ReactNode;
  /** Quiet context after the title: "73 titles", "most popular first". */
  note?: ReactNode;
  /** One action for the section, e.g. a "See all" link, aligned right. */
  action?: ReactNode;
  /** For aria-labelledby on the section it heads. */
  id?: string;
  /** h2 by default; h3 inside a section that already has an h2. */
  as?: "h2" | "h3";
  /** Draw a hairline under the header (use when items follow directly). */
  divider?: boolean;
  className?: string;
}

/** The heading of a group of content within a page. */
export default function SectionHeader({
  title,
  note,
  action,
  id,
  as: Heading = "h2",
  divider = false,
  className,
}: Props) {
  return (
    <div
      className={cx(
        "flex flex-wrap items-baseline gap-x-3 gap-y-1",
        divider && "pb-3 border-b border-neutral-800",
        className,
      )}
    >
      <Heading
        id={id}
        tabIndex={-1}
        className="text-title font-semibold text-neutral-100 focus:outline-none"
      >
        {title}
      </Heading>
      {note && <span className="text-label text-neutral-400">{note}</span>}
      {action && <div className="ml-auto">{action}</div>}
    </div>
  );
}
