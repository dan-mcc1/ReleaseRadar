import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  householdErrorMessage,
  useAddHouseholdItem,
  useHouseholdPicks,
  type HouseholdDetail,
  type PickTime,
  type TonightPick,
} from "../hooks/api/useHouseholds";
import { useToast } from "./Toast";
import MemberAvatar from "./MemberAvatar";
import WatchedTogetherModal, { type LogTarget } from "./WatchedTogetherModal";
import { Button, Card, Chip, EmptyState, IconButton, PageState, PlusIcon, Segmented, cx } from "./ui";
import HouseholdSwipe from "./HouseholdSwipe";
import { describe, reasonText, type Namer } from "./tonightText";
import { episodeCode, personName } from "../utils/households";

type Mode = "ranked" | "surprise" | "swipe";

const SURPRISE_POOL = 10;

const TIME_OPTIONS: { value: PickTime; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "short", label: "~30 min" },
  { value: "hour", label: "~1 hour" },
  { value: "movie", label: "A movie" },
];

const pickKey = (p: TonightPick) => `${p.content_type}-${p.id}`;

interface CardProps {
  pick: TonightPick;
  present: string[];
  nameOf: Namer;
  uid: string | undefined;
  householdId: number;
  big?: boolean;
  /** The list on screen is from the previous filters while new picks load. */
  stale?: boolean;
  onLog: (pick: TonightPick) => void;
}

function TonightCard({ pick, present, nameOf, uid, householdId, big, stale = false, onLog }: CardProps) {
  const add = useAddHouseholdItem();
  const toast = useToast();
  const { label, runtime } = describe(pick);
  const reasons = pick.reasons.slice(0, 2).map((r) => reasonText(r, present, nameOf, uid));
  const onList = pick.reasons.some((r) => r.type === "shared_list");
  const canAdd = !onList && pick.reasons.some((r) => r.type === "recommended");
  const canLog = pick.content_type === "movie" || pick.episode !== null;
  const posterWidth = big ? "w-32 sm:w-44" : "w-20";
  const posterHeight = big ? "h-48 sm:h-[264px]" : "h-[117px]";

  return (
    <Card as="article" padding="sm" aria-label={pick.title} className={cx("flex gap-4", big && "sm:gap-6 sm:p-6")}>
      {pick.poster_path ? (
        <img
          src={`${BASE_IMAGE_URL}/${big ? "w342" : "w154"}${pick.poster_path}`}
          alt=""
          loading="lazy"
          className={cx(
            posterWidth,
            posterHeight,
            "flex-shrink-0 rounded-control border border-white/10 object-cover",
          )}
        />
      ) : (
        <div className={cx(posterWidth, posterHeight, "flex-shrink-0 rounded-control bg-neutral-800")} aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <h3 className={cx("font-semibold text-neutral-100", big ? "text-heading" : "truncate text-label")}>
          <Link to={`/${pick.content_type}/${pick.id}`} className="hover:underline">
            {pick.title}
          </Link>
          {pick.year && <span className="ml-2 text-body font-normal text-neutral-400 tabular">{pick.year}</span>}
        </h3>
        <p className="mt-1 text-caption text-neutral-300">
          {label}
          {runtime && <span className="tabular"> · {runtime}</span>}
          {pick.certification && <span> · {pick.certification}</span>}
        </p>
        {pick.services.length > 0 && (
          <p className="mt-0.5 text-caption text-neutral-400">
            On {pick.services.map((s) => s.name).join(", ")}
          </p>
        )}
        {reasons.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1">
            {reasons.map((text) => (
              <li key={text} className="text-caption text-info-300">
                {text}
              </li>
            ))}
          </ul>
        )}
        {(canLog || canAdd) && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {canLog && (
              <Button size="sm" disabled={stale} onClick={() => onLog(pick)}>
                We watched it
              </Button>
            )}
            {canAdd && (
              <IconButton
                label={`Add ${pick.title} to the Watch together list`}
                icon={<PlusIcon />}
                disabled={add.isPending || stale}
                onClick={() =>
                  add.mutate(
                    { householdId, contentType: pick.content_type, contentId: pick.id },
                    {
                      onSuccess: () => toast.success(`Added ${pick.title} to your list`),
                      onError: (err) => toast.error(householdErrorMessage(err)),
                    },
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

/** Choose at random from the pool, never the one just shown when there is a choice. */
function randomKey(pool: TonightPick[], previous: string | null): string | null {
  const options = pool.length > 1 ? pool.filter((p) => pickKey(p) !== previous) : pool;
  if (options.length === 0) return null;
  return pickKey(options[Math.floor(Math.random() * options.length)]);
}

/** Tonight: who is watching, a few filters, then ranked picks or one random one. */
export default function HouseholdTonight({ h }: { h: HouseholdDetail }) {
  const user = useAuthUser();
  const uid = user?.uid;
  const [off, setOff] = useState<string[]>([]);
  const [time, setTime] = useState<PickTime>("any");
  const [services, setServices] = useState(false);
  const [kids, setKids] = useState(false);
  const [mode, setMode] = useState<Mode>("ranked");
  const [chosen, setChosen] = useState<string | null>(null);
  const [logging, setLogging] = useState<{ target: LogTarget; present: string[] } | null>(null);

  const present = h.members.map((m) => m.user_id).filter((u) => !off.includes(u));
  const { data, isPending, isPlaceholderData, error, refetch } = useHouseholdPicks(h.id, {
    present,
    time,
    services,
    kids,
  });

  const nameOf: Namer = (userId) => {
    if (userId === uid) return "You";
    const m = h.members.find((x) => x.user_id === userId);
    return m ? personName(m) : "Someone";
  };

  const picks = data?.picks ?? [];
  const pool = picks.slice(0, SURPRISE_POOL);
  const poolKeys = pool.map(pickKey).join("|");

  useEffect(() => {
    if (mode !== "surprise" || pool.length === 0) return;
    if (chosen === null || !pool.some((p) => pickKey(p) === chosen)) setChosen(randomKey(pool, null));
    // pool is derived from poolKeys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, poolKeys, chosen]);

  const toggleMember = (userId: string) =>
    setOff((prev) => {
      if (prev.includes(userId)) return prev.filter((u) => u !== userId);
      return present.length > 1 ? [...prev, userId] : prev;
    });

  const onLog = (pick: TonightPick) => {
    if (pick.content_type === "movie") {
      setLogging({ present, target: { contentType: "movie", contentId: pick.id, label: pick.title } });
      return;
    }
    if (!pick.episode) return;
    setLogging({
      present,
      target: {
        contentType: "tv",
        contentId: pick.id,
        seasonNumber: pick.episode.season_number,
        episodeNumber: pick.episode.episode_number,
        label: `${pick.title} ${episodeCode(pick.episode)}`,
      },
    });
  };

  const anyFilter = time !== "any" || services || kids;
  const shown = pool.find((p) => pickKey(p) === chosen) ?? null;
  const cardProps = { present, nameOf, uid, householdId: h.id, onLog, stale: isPlaceholderData };

  let body;
  if (mode === "swipe") {
    body = (
      <HouseholdSwipe h={h} present={present} time={time} services={services} kids={kids} nameOf={nameOf} uid={uid} />
    );
  } else if (isPending) {
    body = <PageState status="loading" label="Finding picks…" />;
  } else if (error || !data) {
    body = <PageState status="error" error={error} subject="picks" onRetry={() => refetch()} />;
  } else if (picks.length === 0) {
    body = (
      <EmptyState
        className="py-12"
        title="Nothing to suggest for tonight"
        description={`Picks come from your Watch together list, things you both want to watch and shows you are watching together.${
          anyFilter ? " Try loosening the filters." : ""
        }`}
      />
    );
  } else if (mode === "surprise") {
    body = shown && (
      <div className="flex flex-col items-start gap-4">
        <TonightCard pick={shown} big {...cardProps} />
        <Button onClick={() => setChosen(randomKey(pool, chosen))}>Spin again</Button>
      </div>
    );
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {picks.map((p) => (
          <TonightCard key={pickKey(p)} pick={p} {...cardProps} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <fieldset>
        <legend className="mb-2 text-caption text-neutral-400">Who is watching?</legend>
        <div className="flex flex-wrap gap-2">
          {h.members.map((m) => {
            const on = !off.includes(m.user_id);
            return (
              <Chip
                key={m.user_id}
                pressed={on}
                disabled={on && present.length === 1}
                onClick={() => toggleMember(m.user_id)}
                className="pl-2"
              >
                <MemberAvatar name={personName(m)} avatarKey={m.avatar_key} size={24} />
                {nameOf(m.user_id)}
              </Chip>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <div className="max-w-full overflow-x-auto">
          <Segmented<PickTime> label="How long" value={time} onChange={setTime} options={TIME_OPTIONS} />
        </div>
        <Chip pressed={services} onClick={() => setServices((v) => !v)}>
          On our services
        </Chip>
        <Chip pressed={kids} onClick={() => setKids((v) => !v)}>
          Kid-friendly
        </Chip>
        <Segmented<Mode>
          label="How to choose"
          value={mode}
          onChange={setMode}
          options={[
            { value: "ranked", label: "Ranked" },
            { value: "surprise", label: "Surprise me" },
            { value: "swipe", label: "Swipe together" },
          ]}
          className="sm:ml-auto"
        />
      </div>

      {body}

      {logging && (
        <WatchedTogetherModal
          open
          onClose={() => setLogging(null)}
          target={logging.target}
          householdId={h.id}
          presentUserIds={logging.present}
        />
      )}
    </div>
  );
}
