import { useEffect, useRef, useState, type PointerEvent } from "react";
import { BASE_IMAGE_URL } from "../constants";
import {
  householdErrorMessage,
  useEndSession,
  useHouseholdSession,
  usePickFromSession,
  useStartSession,
  useSwipe,
  voteKey,
  type Candidate,
  type HouseholdDetail,
  type PickTime,
  type SwipeResultItem,
  type SwipeSession,
} from "../hooks/api/useHouseholds";
import { episodeCode } from "../utils/households";
import { useToast } from "./Toast";
import WatchedTogetherModal, { type LogTarget } from "./WatchedTogetherModal";
import { describe, joinNames, reasonText, type Namer } from "./tonightText";
import { Button, Card, CheckIcon, CloseIcon, EmptyState, PageState, SectionHeader, Segmented, cx } from "./ui";

/** Drag farther than this many pixels and the swipe counts. */
const COMMIT_DISTANCE = 100;

const SIZE_OPTIONS: { value: "5" | "10"; label: string }[] = [
  { value: "5", label: "5 cards" },
  { value: "10", label: "10 cards" },
];

interface Props {
  h: HouseholdDetail;
  present: string[];
  time: PickTime;
  services: boolean;
  kids: boolean;
  nameOf: Namer;
  uid: string | undefined;
}

function logTarget(c: Candidate): LogTarget | null {
  if (c.content_type === "movie") return { contentType: "movie", contentId: c.id, label: c.title };
  if (!c.episode) return null;
  return {
    contentType: "tv",
    contentId: c.id,
    seasonNumber: c.episode.season_number,
    episodeNumber: c.episode.episode_number,
    label: `${c.title} ${episodeCode(c.episode)}`,
  };
}

function Poster({ candidate }: { candidate: Candidate }) {
  return candidate.poster_path ? (
    <img
      src={`${BASE_IMAGE_URL}/w342${candidate.poster_path}`}
      alt=""
      draggable={false}
      className="h-72 w-48 flex-shrink-0 rounded-surface border border-white/10 object-cover"
    />
  ) : (
    <div className="h-72 w-48 flex-shrink-0 rounded-surface bg-neutral-800" aria-hidden="true" />
  );
}

function CandidateDetails({
  candidate,
  session,
  nameOf,
  uid,
}: {
  candidate: Candidate;
  session: SwipeSession;
  nameOf: Namer;
  uid: string | undefined;
}) {
  const { label, runtime } = describe(candidate);
  const reasons = candidate.reasons.slice(0, 2).map((r) => reasonText(r, session.participants, nameOf, uid));
  return (
    <div className="text-center">
      <h3 className="text-heading font-semibold text-neutral-100">
        {candidate.title}
        {candidate.year && <span className="ml-2 text-body font-normal text-neutral-400 tabular">{candidate.year}</span>}
      </h3>
      <p className="mt-1 text-caption text-neutral-300">
        {label}
        {runtime && <span className="tabular"> · {runtime}</span>}
        {candidate.certification && <span> · {candidate.certification}</span>}
      </p>
      {candidate.services.length > 0 && (
        <p className="mt-0.5 text-caption text-neutral-400">On {candidate.services.map((s) => s.name).join(", ")}</p>
      )}
      {reasons.map((text) => (
        <p key={text} className="mt-1 text-caption text-info-300">
          {text}
        </p>
      ))}
    </div>
  );
}

/** The one card on screen: drag it sideways, or use the buttons or arrow keys. */
function SwipeCard({
  candidate,
  session,
  nameOf,
  uid,
  onVote,
}: {
  candidate: Candidate;
  session: SwipeSession;
  nameOf: Namer;
  uid: string | undefined;
  onVote: (vote: boolean) => void;
}) {
  const [dx, setDx] = useState(0);
  const [startX, setStartX] = useState<number | null>(null);

  const down = (e: PointerEvent<HTMLElement>) => {
    // Main button or a single finger only: no right-click or second-touch drags.
    if (e.button > 0 || e.isPrimary === false) return;
    setStartX(e.clientX);
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    if (startX !== null) setDx(e.clientX - startX);
  };
  const up = (e: PointerEvent<HTMLElement>) => {
    if (startX === null || e.isPrimary === false) return;
    const moved = e.clientX - startX;
    setStartX(null);
    setDx(0);
    if (Math.abs(moved) >= COMMIT_DISTANCE) onVote(moved > 0);
  };
  const cancel = () => {
    setStartX(null);
    setDx(0);
  };

  const dragging = startX !== null;
  return (
    <Card
      as="article"
      aria-label={candidate.title}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      style={{
        transform: dx ? `translateX(${dx}px) rotate(${dx / 25}deg)` : undefined,
        touchAction: "pan-y",
      }}
      className={cx(
        "flex w-full max-w-sm cursor-grab select-none flex-col items-center gap-4 sm:p-6",
        !dragging && "transition-transform duration-150 motion-reduce:transition-none",
      )}
    >
      <Poster candidate={candidate} />
      <CandidateDetails candidate={candidate} session={session} nameOf={nameOf} uid={uid} />
    </Card>
  );
}

function ProgressLine({
  session,
  nameOf,
  uid,
  includeMe,
}: {
  session: SwipeSession;
  nameOf: Namer;
  uid: string | undefined;
  includeMe: boolean;
}) {
  const total = session.candidates.length;
  const people = session.participants.filter((p) => includeMe || p !== uid);
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-caption text-neutral-400">
      {people.map((p) => (
        <li key={p} className="tabular">
          {nameOf(p)} {session.progress[p] ?? 0}/{total}
        </li>
      ))}
    </ul>
  );
}

function SessionPanel({
  session,
  h,
  nameOf,
  uid,
}: {
  session: SwipeSession;
  h: HouseholdDetail;
  nameOf: Namer;
  uid: string | undefined;
}) {
  const toast = useToast();
  const swipe = useSwipe();
  const end = useEndSession();
  // The last title swiped, so Undo can bring it back to change the vote.
  const [last, setLast] = useState<Candidate | null>(null);
  const [reviewing, setReviewing] = useState<Candidate | null>(null);

  const total = session.candidates.length;
  const voted = Object.keys(session.my_votes).length;
  const current = reviewing ?? session.candidates.find((c) => !(voteKey(c) in session.my_votes)) ?? null;

  const vote = (v: boolean) => {
    if (!current) return;
    const candidate = current;
    setLast(candidate);
    setReviewing(null);
    swipe.mutate(
      { householdId: h.id, sessionId: session.id, contentType: candidate.content_type, contentId: candidate.id, vote: v },
      { onError: (err) => toast.error(householdErrorMessage(err, "Couldn't save that swipe. Try again.")) },
    );
  };
  const voteRef = useRef(vote);
  useEffect(() => {
    voteRef.current = vote;
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
      if (e.repeat) return; // a held key is one swipe, not the whole stack
      if (e.target instanceof Element && e.target.closest("input, select, textarea, [role=dialog]")) return;
      voteRef.current(e.key === "ArrowRight");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const endSession = () =>
    end.mutate(
      { householdId: h.id, sessionId: session.id },
      { onError: (err) => toast.error(householdErrorMessage(err, "Couldn't end the session. Try again.")) },
    );

  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-label text-neutral-300 tabular">
        {voted} of {total} swiped
      </p>

      {current ? (
        <>
          <SwipeCard
            key={voteKey(current)}
            candidate={current}
            session={session}
            nameOf={nameOf}
            uid={uid}
            onVote={vote}
          />
          <div className="flex items-center gap-3">
            <Button icon={<CloseIcon />} onClick={() => vote(false)}>
              No
            </Button>
            <Button variant="primary" icon={<CheckIcon />} onClick={() => vote(true)}>
              Yes
            </Button>
          </div>
        </>
      ) : (
        <EmptyState
          className="py-8"
          title="Waiting for the others"
          description="You've swiped everything. The results show once everyone's done."
        />
      )}

      <ProgressLine session={session} nameOf={nameOf} uid={uid} includeMe={false} />

      <div className="flex items-center gap-2">
        {last && !reviewing && (
          <Button variant="ghost" size="sm" onClick={() => setReviewing(last)}>
            Undo
          </Button>
        )}
        <Button variant="ghost" size="sm" disabled={end.isPending} onClick={endSession}>
          End session
        </Button>
      </div>

    </div>
  );
}

/** One item at random, for "Pick one for us"; called from a click, not render. */
function randomItem<T>(items: T[]): T | undefined {
  return items[Math.floor(Math.random() * items.length)];
}

/** Groups of results by how many said yes, most first: [3, [...]], [2, [...]]. */
function tiers(results: SwipeResultItem[]): [number, SwipeResultItem[]][] {
  const out: [number, SwipeResultItem[]][] = [];
  for (const r of results) {
    const last = out[out.length - 1];
    if (last && last[0] === r.yes) last[1].push(r);
    else out.push([r.yes, [r]]);
  }
  return out;
}

/** Once everyone has swiped every card: what you all agreed on, then the rest. */
function ResultsPanel({
  session,
  h,
  uid,
  onNewRound,
  starting,
}: {
  session: SwipeSession;
  h: HouseholdDetail;
  uid: string | undefined;
  onNewRound: () => void;
  starting: boolean;
}) {
  const toast = useToast();
  const pick = usePickFromSession();
  const canPick = !!uid && session.participants.includes(uid);
  const results = session.results ?? [];
  const everyone = session.matches;
  const groups = tiers(results.filter((r) => r.yes < r.of));
  // "Pick one for us" draws from everyone's yeses, or the closest tier if none.
  const pool = everyone.length > 0 ? everyone : (groups[0]?.[1] ?? []);

  const choose = (c: { content_type: "tv" | "movie"; id: number }) =>
    pick.mutate(
      { householdId: h.id, sessionId: session.id, contentType: c.content_type, contentId: c.id },
      { onError: (err) => toast.error(householdErrorMessage(err, "Couldn't pick that. Try again.")) },
    );
  const pickRandom = () => {
    const chosen = randomItem(pool);
    if (chosen) choose(chosen);
  };

  const row = (r: SwipeResultItem) => (
    <li key={voteKey(r)} className="flex items-center gap-3 py-2">
      {r.poster_path ? (
        <img
          src={`${BASE_IMAGE_URL}/w92${r.poster_path}`}
          alt=""
          className="h-[54px] w-9 flex-shrink-0 rounded border border-white/10 object-cover"
        />
      ) : (
        <div className="h-[54px] w-9 flex-shrink-0 rounded bg-neutral-800" aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1 truncate text-body text-neutral-100">{r.title}</span>
      {canPick && (
        <Button size="sm" disabled={pick.isPending} onClick={() => choose(r)}>
          Watch this
        </Button>
      )}
    </li>
  );

  if (results.length === 0) {
    return (
      <EmptyState
        title="No yeses this round"
        description="Nobody said yes to any of these. Try another round, maybe with looser filters."
        action={
          <Button variant="primary" loading={starting} onClick={onNewRound}>
            Start a new round
          </Button>
        }
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <section aria-label="Everyone agreed">
        <SectionHeader
          as="h3"
          title={everyone.length > 0 ? "Everyone agreed on" : "Nobody agreed on everything"}
          note={everyone.length > 0 ? `${everyone.length}` : "here's the closest"}
          divider
        />
        {everyone.length > 0 && <ul className="flex flex-col divide-y divide-neutral-800">{everyone.map(row)}</ul>}
        {canPick && pool.length > 0 && (
          <Button variant="primary" className="mt-3" disabled={pick.isPending} onClick={pickRandom}>
            Pick one for us
          </Button>
        )}
      </section>

      {groups.map(([yes, items]) => (
        <section key={yes} aria-label={`${yes} of ${items[0].of} said yes`}>
          <SectionHeader as="h3" title={`${yes} of ${items[0].of} of you said yes`} divider />
          <ul className="flex flex-col divide-y divide-neutral-800">{items.map(row)}</ul>
        </section>
      ))}

      <Button className="self-center" loading={starting} onClick={onNewRound}>
        Start a new round
      </Button>
    </div>
  );
}

function PickedPanel({
  session,
  h,
  nameOf,
  uid,
  onNewRound,
  starting,
}: {
  session: SwipeSession;
  h: HouseholdDetail;
  nameOf: Namer;
  uid: string | undefined;
  onNewRound: () => void;
  starting: boolean;
}) {
  const [logging, setLogging] = useState<LogTarget | null>(null);
  const chosen =
    session.candidates.find((c) => session.picked && voteKey(c) === voteKey(session.picked)) ?? null;
  const target = chosen ? logTarget(chosen) : null;
  return (
    <div className="flex flex-col items-center gap-4">
      <p className="text-label text-neutral-300">Tonight&apos;s pick</p>
      {chosen && (
        <Card as="article" aria-label={chosen.title} className="flex w-full max-w-sm flex-col items-center gap-4 sm:p-6">
          <Poster candidate={chosen} />
          <CandidateDetails candidate={chosen} session={session} nameOf={nameOf} uid={uid} />
        </Card>
      )}
      <div className="flex flex-wrap items-center justify-center gap-3">
        {target && (
          <Button variant="primary" onClick={() => setLogging(target)}>
            We watched it
          </Button>
        )}
        <Button loading={starting} onClick={onNewRound}>
          Start a new round
        </Button>
      </div>
      {logging && (
        <WatchedTogetherModal
          open
          onClose={() => setLogging(null)}
          target={logging}
          householdId={h.id}
          presentUserIds={session.participants}
        />
      )}
    </div>
  );
}

/** Swipe to match: everyone swipes the same cards on their own phone; what all say yes to is a match. */
export default function HouseholdSwipe({ h, present, time, services, kids, nameOf, uid }: Props) {
  const toast = useToast();
  const { data: session, isPending, error, refetch } = useHouseholdSession(h.id);
  const start = useStartSession();
  const end = useEndSession();
  const [size, setSize] = useState<"5" | "10">("10");

  const canStart = present.length >= 2 && !!uid && present.includes(uid);
  const startRound = () =>
    start.mutate(
      { householdId: h.id, present, time, services, kids, size: Number(size) },
      { onError: (err) => toast.error(householdErrorMessage(err, "Couldn't start swiping. Try again.")) },
    );

  if (isPending) return <PageState status="loading" label="Loading…" />;
  if (error) return <PageState status="error" error={error} subject="the swipe session" onRetry={() => refetch()} />;

  if (session?.status === "picked") {
    return (
      <PickedPanel
        session={session}
        h={h}
        nameOf={nameOf}
        uid={uid}
        onNewRound={startRound}
        starting={start.isPending}
      />
    );
  }

  if (session?.status === "open" && session.finished) {
    return <ResultsPanel session={session} h={h} uid={uid} onNewRound={startRound} starting={start.isPending} />;
  }

  if (session?.status === "open") {
    if (uid && session.participants.includes(uid)) {
      return <SessionPanel session={session} h={h} nameOf={nameOf} uid={uid} />;
    }
    return (
      <div className="flex flex-col items-center gap-4 py-8 text-center">
        <p className="text-title font-semibold text-neutral-100">
          {joinNames(session.participants, nameOf, uid)} are swiping
        </p>
        <ProgressLine session={session} nameOf={nameOf} uid={uid} includeMe />
        <Button
          size="sm"
          disabled={end.isPending}
          onClick={() =>
            end.mutate(
              { householdId: h.id, sessionId: session.id },
              { onError: (err) => toast.error(householdErrorMessage(err, "Couldn't end the session. Try again.")) },
            )
          }
        >
          End session
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 py-8 text-center">
      <p className="text-title font-semibold text-neutral-100">Swipe to match</p>
      <p className="max-w-md text-body text-neutral-300">
        Everyone watching swipes yes or no on the same titles, each on their own phone. When you&apos;re all done,
        you&apos;ll see what everyone agreed on.
      </p>
      <Segmented<"5" | "10"> label="Round size" value={size} onChange={setSize} options={SIZE_OPTIONS} />
      <Button variant="primary" disabled={!canStart} loading={start.isPending} onClick={startRound}>
        Start swiping
      </Button>
      {!canStart && <p className="text-caption text-neutral-400">Pick at least two people, including you.</p>}
    </div>
  );
}
