import { useState, type FormEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  householdErrorMessage,
  useCancelHouseholdInvite,
  useDeleteHousehold,
  useHousehold,
  useHouseholdProgress,
  useRemoveHouseholdItem,
  useRemoveHouseholdMember,
  useRenameHousehold,
  type HouseholdDetail,
  type HouseholdItem,
  type NextEpisode,
  type ShowProgress,
} from "../hooks/api/useHouseholds";
import MemberAvatar from "../components/MemberAvatar";
import HouseholdInvitePicker from "../components/HouseholdInvitePicker";
import HouseholdPicks from "../components/HouseholdPicks";
import WatchedTogetherModal, { type LogTarget } from "../components/WatchedTogetherModal";
import { useToast } from "../components/Toast";
import {
  Button,
  Card,
  CloseIcon,
  EmptyState,
  IconButton,
  Modal,
  PageHeader,
  PageState,
  PosterCard,
  SectionHeader,
  Segmented,
} from "../components/ui";
import { NAME_MAX, episodeCode, inputClass, personName } from "../utils/households";

type Tab = "together" | "progress" | "members";
const TABS: Tab[] = ["together", "progress", "members"];

type Namer = (userId: string) => string;

function nextLabel(next: NextEpisode): string {
  return next.name ? `${episodeCode(next)} · ${next.name}` : episodeCode(next);
}

// ── Watch together ──────────────────────────────────────────────────────────

function ItemCard({ h, item, nameOf }: { h: HouseholdDetail; item: HouseholdItem; nameOf: Namer }) {
  const remove = useRemoveHouseholdItem();
  const toast = useToast();
  const watchedBy = h.members.filter((m) => item.member_status[m.user_id] === "Watched");
  const subtitle = [item.added_by ? `Added by ${personName(item.added_by)}` : null, item.year]
    .filter(Boolean)
    .join(" · ");

  return (
    <PosterCard
      to={`/${item.content_type}/${item.id}`}
      title={item.title}
      posterPath={item.poster_path}
      subtitle={subtitle}
      footer={
        <p className="truncate text-caption text-neutral-300">
          {watchedBy.length > 0
            ? `Watched: ${watchedBy.map((m) => nameOf(m.user_id)).join(", ")}`
            : "Nobody has watched it yet"}
        </p>
      }
      actions={
        <IconButton
          label={`Remove ${item.title} from the list`}
          icon={<CloseIcon />}
          variant="overlay"
          size="touch"
          disabled={remove.isPending}
          onClick={() =>
            remove.mutate(
              { householdId: h.id, contentType: item.content_type, contentId: item.id },
              { onError: (err) => toast.error(householdErrorMessage(err)) },
            )
          }
        />
      }
    />
  );
}

function TogetherTab({ h, nameOf }: { h: HouseholdDetail; nameOf: Namer }) {
  return (
    <>
      <HouseholdPicks householdId={h.id} memberCount={h.members.length} />
      <SectionHeader title="Your list" note={h.items.length > 0 ? `${h.items.length}` : undefined} className="mb-3" />
      {h.items.length === 0 ? (
        <EmptyState
          className="py-12"
          title="Nothing on the list yet"
          description="Add a pick above, or open any show or movie and choose Watch together."
        />
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
          {h.items.map((item) => (
            <ItemCard key={`${item.content_type}-${item.id}`} h={h} item={item} nameOf={nameOf} />
          ))}
        </div>
      )}
    </>
  );
}

// ── Progress ────────────────────────────────────────────────────────────────

function ProgressCard({
  show,
  nameOf,
  onLog,
}: {
  show: ShowProgress;
  nameOf: Namer;
  onLog: (show: ShowProgress, next: NextEpisode) => void;
}) {
  const next = show.together_next;
  return (
    <Card as="article" padding="sm" aria-label={show.title} className="flex gap-4">
      {show.poster_path ? (
        <img
          src={`${BASE_IMAGE_URL}/w154${show.poster_path}`}
          alt=""
          loading="lazy"
          className="h-[117px] w-20 flex-shrink-0 rounded-control border border-white/10 object-cover"
        />
      ) : (
        <div className="h-[117px] w-20 flex-shrink-0 rounded-control bg-neutral-800" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-label font-semibold text-neutral-100">{show.title}</h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
          {next ? (
            <>
              <p className="text-caption text-neutral-300">Next together: {nextLabel(next)}</p>
              <Button size="sm" onClick={() => onLog(show, next)}>
                We watched it
              </Button>
            </>
          ) : (
            <p className="text-caption text-neutral-400">You are all caught up.</p>
          )}
        </div>
        <ul className="mt-3 flex flex-col gap-1">
          {show.members.map((m) => (
            <li key={m.user_id} className="flex flex-wrap items-baseline gap-x-2 text-caption">
              <span className="font-medium text-neutral-200">{nameOf(m.user_id)}</span>
              <span className="text-neutral-400">
                {m.last_watched ? `On ${episodeCode(m.last_watched)}` : "Not started"}
              </span>
              {m.ahead_by > 0 && <span className="text-info-300 tabular">+{m.ahead_by} ahead</span>}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

function ProgressTab({
  id,
  nameOf,
  onLog,
}: {
  id: number;
  nameOf: Namer;
  onLog: (show: ShowProgress, next: NextEpisode) => void;
}) {
  const { data, isPending, error, refetch } = useHouseholdProgress(id);
  if (isPending) return <PageState status="loading" label="Loading progress…" />;
  if (error || !data) {
    return <PageState status="error" error={error} subject="progress" onRetry={() => refetch()} />;
  }
  if (data.shows.length === 0) {
    return (
      <EmptyState
        title="No shows to track yet"
        description="Add a show to the Watch together list and you will see where everyone is in it."
      />
    );
  }
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {data.shows.map((s) => (
        <ProgressCard key={s.id} show={s} nameOf={nameOf} onLog={onLog} />
      ))}
    </div>
  );
}

// ── Members ─────────────────────────────────────────────────────────────────

function MembersTab({ h, uid, nameOf }: { h: HouseholdDetail; uid: string | undefined; nameOf: Namer }) {
  const cancel = useCancelHouseholdInvite();
  const removeMember = useRemoveHouseholdMember();
  const toast = useToast();
  const isOwner = h.role === "owner";
  const onError = (err: unknown) => toast.error(householdErrorMessage(err));

  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="household-members">
        <SectionHeader
          id="household-members"
          title="Members"
          note={`${h.members.length} of ${h.max_members}`}
          divider
          className="mb-2"
        />
        <ul className="flex flex-col divide-y divide-neutral-800">
          {h.members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-2.5">
              <MemberAvatar name={personName(m)} avatarKey={m.avatar_key} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-label font-medium text-neutral-100">
                  {personName(m)}
                  {m.user_id === uid && <span className="text-neutral-400"> (you)</span>}
                </p>
                <p className="text-caption text-neutral-400">{m.role === "owner" ? "Owner" : "Member"}</p>
              </div>
              {isOwner && m.user_id !== uid && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={removeMember.isPending}
                  onClick={() => removeMember.mutate({ householdId: h.id, userId: m.user_id }, { onError })}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="household-invite">
        <SectionHeader id="household-invite" title="Invite someone" note="friends only" divider className="mb-3" />
        <HouseholdInvitePicker
          householdId={h.id}
          full={h.members.length + h.invites.length >= h.max_members}
        />
        {h.invites.length > 0 && (
          <ul className="mt-4 flex flex-col divide-y divide-neutral-800" aria-label="Pending invites">
            {h.invites.map((i) => (
              <li key={i.id} className="flex items-center gap-3 py-2.5">
                <MemberAvatar name={personName(i)} avatarKey={i.avatar_key} />
                <p className="min-w-0 flex-1 truncate text-label text-neutral-200">
                  {personName(i)} <span className="text-neutral-400">(invited)</span>
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={cancel.isPending}
                  onClick={() => cancel.mutate({ householdId: h.id, inviteId: i.id }, { onError })}
                >
                  Cancel
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="household-services">
        <SectionHeader id="household-services" title="Your services between you" divider className="mb-3" />
        {h.services.length === 0 ? (
          <p className="text-caption text-neutral-400">
            Nobody has added a streaming service yet. Add yours under My services.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {h.services.map((s) => (
              <li key={s.id} className="flex items-center gap-3">
                {s.logo_path ? (
                  <img
                    src={`${BASE_IMAGE_URL}/w92${s.logo_path}`}
                    alt=""
                    className="size-9 flex-shrink-0 rounded-control border border-white/10 object-cover"
                  />
                ) : (
                  <div className="size-9 flex-shrink-0 rounded-control bg-neutral-800" aria-hidden="true" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-label font-medium text-neutral-100">{s.name}</p>
                  <p className="truncate text-caption text-neutral-400">{s.user_ids.map(nameOf).join(", ")}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────

export default function HouseholdPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id ?? 0);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthUser();
  const toast = useToast();

  const { data: h, isPending, error, refetch } = useHousehold(id);
  const rename = useRenameHousehold();
  const del = useDeleteHousehold();
  const leave = useRemoveHouseholdMember();

  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"delete" | "leave" | null>(null);
  const [logging, setLogging] = useState<LogTarget | null>(null);

  usePageTitle(h?.name ?? "Household");

  const requested = searchParams.get("tab") as Tab | null;
  const tab: Tab = requested && TABS.includes(requested) ? requested : "together";
  const setTab = (t: Tab) =>
    setSearchParams(
      (p) => {
        p.set("tab", t);
        return p;
      },
      { replace: true },
    );

  if (isPending) return <PageState status="loading" label="Loading household…" />;
  if (error || !h) {
    return (
      <PageState
        status="error"
        error={error}
        subject="household"
        back={{ to: "/households", label: "Back to your households" }}
        onRetry={() => refetch()}
      />
    );
  }

  const uid = user?.uid;
  const isOwner = h.role === "owner";
  const nameOf: Namer = (userId) => {
    if (userId === uid) return "You";
    const m = h.members.find((x) => x.user_id === userId);
    return m ? personName(m) : "Someone";
  };

  const saveName = (e: FormEvent) => {
    e.preventDefault();
    const name = (renaming ?? "").trim();
    if (!name || name === h.name) {
      setRenaming(null);
      return;
    }
    rename.mutate(
      { id: h.id, name },
      {
        onSuccess: () => setRenaming(null),
        onError: (err) => toast.error(householdErrorMessage(err)),
      },
    );
  };

  const doConfirm = () => {
    if (confirm === "delete") {
      del.mutate(h.id, {
        onSuccess: () => navigate("/households", { replace: true }),
        onError: (err) => toast.error(householdErrorMessage(err)),
      });
    } else if (uid) {
      leave.mutate(
        { householdId: h.id, userId: uid },
        {
          onSuccess: () => navigate("/households", { replace: true }),
          onError: (err) => toast.error(householdErrorMessage(err)),
        },
      );
    }
  };

  const onLog = (show: ShowProgress, next: NextEpisode) =>
    setLogging({
      contentType: "tv",
      contentId: show.id,
      seasonNumber: next.season_number,
      episodeNumber: next.episode_number,
      label: `${show.title} ${episodeCode(next)}`,
    });

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title={h.name}
        description={`${h.members.length} ${h.members.length === 1 ? "member" : "members"}`}
        actions={
          isOwner ? (
            <>
              <Button size="sm" onClick={() => setRenaming(h.name)}>
                Rename
              </Button>
              <Button size="sm" variant="danger" onClick={() => setConfirm("delete")}>
                Delete household
              </Button>
            </>
          ) : (
            <Button size="sm" variant="danger" onClick={() => setConfirm("leave")}>
              Leave household
            </Button>
          )
        }
        className="mb-4"
      />

      {renaming !== null && (
        <form onSubmit={saveName} className="mb-4 flex flex-wrap items-end gap-2">
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <label htmlFor="rename-household" className="text-caption text-neutral-400">
              Household name
            </label>
            <input
              id="rename-household"
              value={renaming}
              onChange={(e) => setRenaming(e.target.value)}
              maxLength={NAME_MAX}
              autoFocus
              className={inputClass}
            />
          </div>
          <Button type="submit" variant="primary" loading={rename.isPending} disabled={!renaming.trim() || rename.isPending}>
            Save
          </Button>
          <Button variant="ghost" onClick={() => setRenaming(null)}>
            Cancel
          </Button>
        </form>
      )}

      <Segmented<Tab>
        label="Household sections"
        value={tab}
        onChange={setTab}
        options={[
          { value: "together", label: "Watch together" },
          { value: "progress", label: "Progress" },
          { value: "members", label: "Members" },
        ]}
        className="mb-6"
      />

      {tab === "together" && <TogetherTab h={h} nameOf={nameOf} />}
      {tab === "progress" && <ProgressTab id={h.id} nameOf={nameOf} onLog={onLog} />}
      {tab === "members" && <MembersTab h={h} uid={uid} nameOf={nameOf} />}

      {logging && (
        <WatchedTogetherModal open onClose={() => setLogging(null)} target={logging} householdId={h.id} />
      )}

      <Modal
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm === "delete" ? `Delete ${h.name}?` : `Leave ${h.name}?`}
        description={
          confirm === "delete"
            ? "This removes the shared list for everyone. Members keep their own lists."
            : "You will stop seeing the shared list. Your own lists stay as they are."
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={doConfirm}
              loading={del.isPending || leave.isPending}
              disabled={del.isPending || leave.isPending}
            >
              {confirm === "delete" ? "Delete household" : "Leave household"}
            </Button>
          </>
        }
      />
    </div>
  );
}
