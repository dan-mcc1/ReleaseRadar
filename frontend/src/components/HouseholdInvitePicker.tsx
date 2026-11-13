import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Link } from "react-router-dom";
import {
  householdErrorMessage,
  useHouseholdInvitable,
  useInviteToHousehold,
  type InvitableFriend,
} from "../hooks/api/useHouseholds";
import MemberAvatar from "./MemberAvatar";
import { useToast } from "./Toast";
import { CheckIcon, IconButton, PlusIcon, cx } from "./ui";
import { inputClass, personName } from "../utils/households";

const MAX_SUGGESTIONS = 6;

function matches(f: InvitableFriend, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return f.username.toLowerCase().includes(q) || (f.display_name ?? "").toLowerCase().includes(q);
}

/**
 * Inviting a friend: a search box whose dropdown suggests friends as you
 * type, and below it every friend not yet in the household with a + button.
 * Invites are friends-only, so the list is the whole set of people you can ask.
 */
export default function HouseholdInvitePicker({ householdId, full }: { householdId: number; full: boolean }) {
  const { data: friends, isPending, isError } = useHouseholdInvitable(householdId);
  const invite = useInviteToHousehold();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputId = useId();

  const suggestions = useMemo(
    () => (friends ?? []).filter((f) => !f.invited && matches(f, query)).slice(0, MAX_SUGGESTIONS),
    [friends, query],
  );

  const send = (f: InvitableFriend) =>
    invite.mutate(
      { householdId, username: f.username },
      {
        onSuccess: () => {
          setQuery("");
          setOpen(false);
          toast.success(`Invited ${personName(f)}`);
        },
        onError: (err) => toast.error(householdErrorMessage(err)),
      },
    );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const pick = suggestions[active];
      if (open && pick) send(pick);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  if (isPending) return <p className="text-caption text-neutral-400">Loading your friends…</p>;
  if (isError) return <p className="text-caption text-neutral-400">Couldn't load your friends right now.</p>;
  if (!friends || friends.length === 0) {
    return (
      <p className="text-caption text-neutral-400">
        Households are for friends. <Link to="/friends" className="text-primary-400 hover:text-primary-300">Add a friend</Link>{" "}
        first, then invite them here.
      </p>
    );
  }
  if (full) {
    return <p className="text-caption text-neutral-400">This household is full.</p>;
  }

  const showList = open && query.trim().length > 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Search with suggestions */}
      <div className="relative max-w-md">
        <label htmlFor={inputId} className="text-caption text-neutral-400">
          Search your friends
        </label>
        <input
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && suggestions[active] ? `${listId}-${active}` : undefined}
          value={query}
          placeholder="Name or username"
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onFocus={() => setOpen(true)}
          // Let a click on a suggestion land before the list closes.
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          onKeyDown={onKeyDown}
          className={cx(inputClass, "mt-1 w-full")}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            className="absolute z-20 mt-1 w-full overflow-hidden rounded-control border border-neutral-700 bg-neutral-900 py-1 shadow-2xl shadow-black/40"
          >
            {suggestions.length === 0 ? (
              <li className="px-3 py-2 text-caption text-neutral-400">No friends match "{query.trim()}".</li>
            ) : (
              suggestions.map((f, i) => (
                <li
                  key={f.user_id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => send(f)}
                  className={cx(
                    "flex cursor-pointer items-center gap-3 px-3 py-2",
                    i === active ? "bg-white/5" : "",
                  )}
                >
                  <MemberAvatar name={personName(f)} avatarKey={f.avatar_key} />
                  <span className="min-w-0 flex-1 truncate text-label text-neutral-100">{personName(f)}</span>
                  {f.display_name && <span className="truncate text-caption text-neutral-400">@{f.username}</span>}
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Every friend, one tap to invite */}
      <div>
        <p className="mb-1 text-caption text-neutral-400">Your friends</p>
        <ul className="flex flex-col divide-y divide-neutral-800">
          {friends.map((f) => (
            <li key={f.user_id} className="flex items-center gap-3 py-2">
              <MemberAvatar name={personName(f)} avatarKey={f.avatar_key} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label text-neutral-100">{personName(f)}</p>
                {f.display_name && <p className="truncate text-caption text-neutral-400">@{f.username}</p>}
              </div>
              {f.invited ? (
                <span className="inline-flex items-center gap-1 text-caption text-neutral-400">
                  <CheckIcon className="w-3.5 h-3.5" /> Invited
                </span>
              ) : (
                <IconButton
                  label={`Invite ${personName(f)}`}
                  icon={<PlusIcon />}
                  size="sm"
                  variant="secondary"
                  disabled={invite.isPending}
                  onClick={() => send(f)}
                />
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
