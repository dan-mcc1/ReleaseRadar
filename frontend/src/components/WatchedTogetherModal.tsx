import { useState } from "react";
import { Button, Modal, selectClass, cx } from "./ui";
import { useToast } from "./Toast";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  householdErrorMessage,
  useHouseholds,
  useLogForHousehold,
} from "../hooks/api/useHouseholds";
import { loggedMessage, personName } from "../utils/households";

/** What is being logged: a movie, a whole season, or one episode. */
export interface LogTarget {
  contentType: "tv" | "movie";
  contentId: number;
  seasonNumber?: number;
  episodeNumber?: number;
  /** Shown under the title: "Severance S2 E4". */
  label?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  target: LogTarget;
  /** Fixes the household (no picker), e.g. from a household's own page. */
  householdId?: number;
}

/** Log one watch for everyone who was in the room. */
export default function WatchedTogetherModal({ open, onClose, target, householdId }: Props) {
  const user = useAuthUser();
  const toast = useToast();
  const { data } = useHouseholds();
  const log = useLogForHousehold();
  const households = data?.households ?? [];

  const [pickedId, setPickedId] = useState<number | null>(null);
  // Everyone starts checked, so only the unchecked are tracked, per household.
  const [unchecked, setUnchecked] = useState<Record<number, string[]>>({});

  const activeId = householdId ?? pickedId ?? households[0]?.id;
  const household = households.find((h) => h.id === activeId);
  const skipped = (activeId !== undefined && unchecked[activeId]) || [];
  const selected = household?.members.filter((m) => !skipped.includes(m.user_id)) ?? [];

  const toggle = (userId: string) => {
    if (activeId === undefined) return;
    setUnchecked((prev) => {
      const cur = prev[activeId] ?? [];
      return {
        ...prev,
        [activeId]: cur.includes(userId) ? cur.filter((u) => u !== userId) : [...cur, userId],
      };
    });
  };

  const submit = () => {
    if (!household || selected.length === 0) return;
    log.mutate(
      {
        householdId: household.id,
        userIds: selected.map((m) => m.user_id),
        contentType: target.contentType,
        contentId: target.contentId,
        seasonNumber: target.seasonNumber,
        episodeNumber: target.episodeNumber,
      },
      {
        onSuccess: (res) => {
          toast.success(loggedMessage(res.logged?.length ?? selected.length));
          onClose();
        },
        onError: (err) => toast.error(householdErrorMessage(err)),
      },
    );
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Who watched?"
      description={target.label}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            loading={log.isPending}
            disabled={!household || selected.length === 0 || log.isPending}
          >
            Log watch
          </Button>
        </>
      }
    >
      {households.length > 1 && householdId === undefined && (
        <div className="mb-4">
          <label htmlFor="watched-together-household" className="mb-1 block text-caption text-neutral-400">
            Household
          </label>
          <select
            id="watched-together-household"
            value={activeId}
            onChange={(e) => setPickedId(Number(e.target.value))}
            className={cx(selectClass, "w-full")}
          >
            {households.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <fieldset>
        <legend className="mb-2 text-caption text-neutral-400">Everyone in the room</legend>
        <ul className="flex flex-col gap-1">
          {(household?.members ?? []).map((m) => {
            const isMe = m.user_id === user?.uid;
            return (
              <li key={m.user_id}>
                <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-control px-2 hover:bg-white/5">
                  <input
                    type="checkbox"
                    checked={!skipped.includes(m.user_id)}
                    onChange={() => toggle(m.user_id)}
                    className="size-4 accent-primary-500"
                  />
                  <span className="text-body text-neutral-100">{isMe ? "You" : personName(m)}</span>
                </label>
              </li>
            );
          })}
        </ul>
      </fieldset>
    </Modal>
  );
}
