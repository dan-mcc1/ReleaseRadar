import { Link } from "react-router-dom";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { CheckIcon, ChevronDownIcon, UsersIcon, cx } from "./ui";
import { useToast } from "./Toast";
import {
  householdErrorMessage,
  useAddHouseholdItem,
  useHouseholds,
  useHouseholdsContaining,
  useRemoveHouseholdItem,
} from "../hooks/api/useHouseholds";

interface Props {
  contentType: "movie" | "tv";
  contentId: number;
  /** Row styling from the surrounding action list. */
  className?: string;
}

/** Adds the title to, or removes it from, a household's Watch together list. */
export default function AddToHouseholdButton({ contentType, contentId, className }: Props) {
  const toast = useToast();
  const { data } = useHouseholds();
  const households = data?.households ?? [];
  const { data: containing = [] } = useHouseholdsContaining(contentType, contentId, households.length > 0);
  const add = useAddHouseholdItem();
  const remove = useRemoveHouseholdItem();
  const busy = add.isPending || remove.isPending;

  // Wait for the list so signed-in visitors with households don't see a flash.
  if (!data) return null;

  if (households.length === 0) {
    return (
      <Link to="/households" className={className}>
        <UsersIcon className="w-4 h-4 shrink-0 text-neutral-400" />
        Start a household
      </Link>
    );
  }

  const toggle = (householdId: number, name: string, has: boolean) => {
    const ref = { householdId, contentType, contentId };
    const onError = (err: unknown) => toast.error(householdErrorMessage(err));
    if (has) {
      remove.mutate(ref, { onSuccess: () => toast.success(`Removed from ${name}`), onError });
    } else {
      add.mutate(ref, { onSuccess: () => toast.success(`Added to ${name}`), onError });
    }
  };

  return (
    <Popover className="relative">
      <PopoverButton className={className}>
        <UsersIcon className={cx("w-4 h-4 shrink-0", containing.length > 0 ? "text-info-400" : "text-neutral-400")} />
        <span className="flex-1">
          {containing.length > 0 ? `Watch together (${containing.length})` : "Watch together"}
        </span>
        <ChevronDownIcon className="w-3.5 h-3.5 shrink-0 text-neutral-500" />
      </PopoverButton>
      <PopoverPanel className="absolute top-full mt-1 right-0 lg:right-auto lg:left-0 w-60 bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl shadow-black/60 z-30 overflow-hidden">
        <ul className="py-1">
          {households.map((h) => {
            const has = containing.includes(h.id);
            return (
              <li key={h.id}>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={has}
                  disabled={busy}
                  onClick={() => toggle(h.id, h.name, has)}
                  className="flex min-h-10 w-full items-center gap-2 px-3 text-left text-label text-neutral-200 hover:bg-white/5 disabled:opacity-60"
                >
                  <span className="flex-1 truncate">{h.name}</span>
                  {has && <CheckIcon className="w-4 h-4 text-primary-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      </PopoverPanel>
    </Popover>
  );
}
