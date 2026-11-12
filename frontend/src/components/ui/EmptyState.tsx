import type { ReactNode } from "react";
import { cx } from "./styles";

interface Props {
  /** What's empty, plainly: "Nothing watched yet". */
  title: ReactNode;
  /** What to do about it, in a sentence. */
  description?: ReactNode;
  /** The way out: a Button or ButtonLink, or a few of them. */
  action?: ReactNode;
  className?: string;
}

/** What a list or grid shows when it has nothing to show. */
export default function EmptyState({ title, description, action, className }: Props) {
  return (
    <div className={cx("flex flex-col items-center py-20 px-6 text-center", className)}>
      <p className="text-title font-medium text-neutral-200">{title}</p>
      {description && <p className="mt-1.5 max-w-md text-body text-neutral-400">{description}</p>}
      {action && <div className="mt-5 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}
