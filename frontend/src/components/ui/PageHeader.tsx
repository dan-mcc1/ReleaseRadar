import type { ReactNode } from "react";
import { cx } from "./styles";

interface Props {
  /** The page's name: "Watched", "Calendar". Plain words, no decoration. */
  title: ReactNode;
  /** One line of context under the title, e.g. "467 titles · 14 rated". */
  description?: ReactNode;
  /** Controls for the whole page (sort, view, filters), aligned right. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The top of a page: its title, an optional line of context and its
 * page-level controls. There is deliberately no eyebrow/kicker slot above the
 * title: the title carries the page.
 */
export default function PageHeader({ title, description, actions, className }: Props) {
  return (
    <header className={cx("flex flex-wrap items-end gap-x-6 gap-y-4", className)}>
      <div className="flex-1 basis-72 min-w-0">
        <h1 className="text-display font-semibold text-neutral-50 [text-wrap:balance]">{title}</h1>
        {description && <p className="mt-2 text-body text-neutral-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}
