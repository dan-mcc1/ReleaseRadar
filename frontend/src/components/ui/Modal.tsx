import type { ReactNode, RefObject } from "react";
import { Description, Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import IconButton from "./IconButton";
import { CloseIcon } from "./icons";
import { cx } from "./styles";

type Size = "sm" | "md" | "lg" | "xl";

const SIZES: Record<Size, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-3xl",
};

export interface ModalProps {
  open: boolean;
  /** Called on Escape, a click outside and the close button. Omit, with
   *  `dismissible={false}`, for a modal that must be answered. */
  onClose: () => void;
  /** Names the dialog for screen readers. Always required; `hideTitle` keeps
   *  it for them but doesn't show it (e.g. a video player). */
  title: ReactNode;
  hideTitle?: boolean;
  /** One line under the title, announced with it. */
  description?: ReactNode;
  children?: ReactNode;
  /** Buttons along the bottom, right-aligned. */
  footer?: ReactNode;
  size?: Size;
  /** false: no close button, and Escape / outside clicks do nothing. */
  dismissible?: boolean;
  /** "bare" drops the panel chrome and padding, for media (trailers). */
  variant?: "panel" | "bare";
  /** Element to focus on open; defaults to the first focusable one. */
  initialFocus?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * The one dialog for the app. Built on headlessui's Dialog, so focus is
 * trapped inside, Escape closes it, focus returns to the opener, the rest of
 * the page is inert, and the title labels it for screen readers.
 */
export default function Modal({
  open,
  onClose,
  title,
  hideTitle = false,
  description,
  children,
  footer,
  size = "md",
  dismissible = true,
  variant = "panel",
  initialFocus,
  className,
}: ModalProps) {
  const bare = variant === "bare";
  return (
    <Dialog
      open={open}
      onClose={dismissible ? onClose : () => {}}
      initialFocus={initialFocus}
      className="relative z-50"
    >
      <DialogBackdrop className="fixed inset-0 bg-black/75 backdrop-blur-sm" />
      <div className="fixed inset-0 overflow-y-auto">
        <div className="flex min-h-full items-center justify-center p-4">
          <DialogPanel
            className={cx(
              "relative w-full",
              SIZES[size],
              !bare &&
                "rounded-surface border border-neutral-700 bg-neutral-900 p-6 shadow-2xl",
              className,
            )}
          >
            <div className={cx(hideTitle ? "sr-only" : "pr-10", !hideTitle && "mb-4")}>
              <DialogTitle className="text-title font-semibold text-neutral-50">
                {title}
              </DialogTitle>
              {description && (
                <Description className="mt-1 text-body text-neutral-400">
                  {description}
                </Description>
              )}
            </div>

            {dismissible && (
              <IconButton
                label="Close"
                icon={<CloseIcon />}
                size="sm"
                variant={bare ? "overlay" : "ghost"}
                onClick={onClose}
                className={cx("absolute", bare ? "-top-3 -right-3" : "top-4 right-4")}
              />
            )}

            {children}

            {footer && (
              <div className="mt-6 flex flex-wrap items-center justify-end gap-2">{footer}</div>
            )}
          </DialogPanel>
        </div>
      </div>
    </Dialog>
  );
}
