import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  householdErrorMessage,
  useAcceptHouseholdInvite,
  useCreateHousehold,
  useDeclineHouseholdInvite,
  useHouseholds,
  type HouseholdInvite,
  type HouseholdSummary,
} from "../hooks/api/useHouseholds";
import MemberAvatar from "../components/MemberAvatar";
import { useToast } from "../components/Toast";
import { Button, Card, EmptyState, PageHeader, PageState, SectionHeader } from "../components/ui";
import { NAME_MAX, inputClass, personName } from "../utils/households";

function NewHouseholdForm() {
  const [name, setName] = useState("");
  const create = useCreateHousehold();
  const toast = useToast();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return;
    create.mutate(trimmed, {
      onSuccess: () => {
        setName("");
        toast.success(`Created ${trimmed}`);
      },
      onError: (err) => toast.error(householdErrorMessage(err)),
    });
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label htmlFor="new-household" className="text-caption text-neutral-400">
          New household
        </label>
        <input
          id="new-household"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={NAME_MAX}
          placeholder="Our place"
          className={inputClass}
        />
      </div>
      <Button
        type="submit"
        variant="primary"
        loading={create.isPending}
        disabled={!name.trim() || create.isPending}
      >
        Create household
      </Button>
    </form>
  );
}

function InviteCard({ invite }: { invite: HouseholdInvite }) {
  const accept = useAcceptHouseholdInvite();
  const decline = useDeclineHouseholdInvite();
  const toast = useToast();
  const busy = accept.isPending || decline.isPending;

  const onAccept = () =>
    accept.mutate(invite.id, {
      onSuccess: () => toast.success(`Joined ${invite.household.name}`),
      onError: (err) => toast.error(householdErrorMessage(err)),
    });
  const onDecline = () =>
    decline.mutate(invite.id, {
      onError: (err) => toast.error(householdErrorMessage(err)),
    });

  return (
    <Card as="article" padding="sm" className="flex flex-col gap-3">
      <div>
        <h3 className="text-label font-semibold text-neutral-100">{invite.household.name}</h3>
        <p className="text-caption text-neutral-400">
          {invite.invited_by ? `${personName(invite.invited_by)} invited you` : "You were invited"}
          {" · "}
          {invite.household.member_count} {invite.household.member_count === 1 ? "member" : "members"}
        </p>
      </div>
      <p className="text-caption text-neutral-400">
        Joining lets members see your lists and progress on shared titles, and log watches for you.
      </p>
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={onAccept} loading={accept.isPending} disabled={busy}>
          Accept
        </Button>
        <Button size="sm" onClick={onDecline} loading={decline.isPending} disabled={busy}>
          Decline
        </Button>
      </div>
    </Card>
  );
}

function HouseholdCard({ h }: { h: HouseholdSummary }) {
  return (
    <Card as="article" padding="sm" className="transition-colors hover:border-neutral-600">
      <Link to={`/households/${h.id}`} className="flex flex-col gap-3">
        <div className="flex items-baseline gap-2">
          <h3 className="min-w-0 flex-1 truncate text-title font-semibold text-neutral-100">{h.name}</h3>
          <span className="text-caption text-neutral-400">{h.role === "owner" ? "Owner" : "Member"}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex -space-x-1.5">
            {h.members.map((m) => (
              <MemberAvatar key={m.user_id} name={personName(m)} avatarKey={m.avatar_key} size={28} />
            ))}
          </div>
          <p className="min-w-0 truncate text-caption text-neutral-300">
            {h.members.map(personName).join(", ")}
          </p>
        </div>
        <p className="text-caption text-neutral-400 tabular">{h.item_count} on your list</p>
      </Link>
    </Card>
  );
}

export default function HouseholdsPage() {
  usePageTitle("Households");
  const { data, isPending, error, refetch } = useHouseholds();

  if (isPending) return <PageState status="loading" label="Loading your households…" />;
  if (error || !data) {
    return (
      <PageState
        status="error"
        error={error}
        subject="page"
        back={{ to: "/calendar", label: "Back to your calendar" }}
        onRetry={() => refetch()}
      />
    );
  }

  const { households, invites } = data;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <PageHeader
        title="Households"
        description="Keep a shared list with the people you watch with."
        className="mb-6"
      />

      {invites.length > 0 && (
        <section className="mb-10" aria-labelledby="household-invites">
          <SectionHeader id="household-invites" title="Invitations" note={`${invites.length} waiting`} className="mb-3" />
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {invites.map((i) => (
              <InviteCard key={i.id} invite={i} />
            ))}
          </div>
        </section>
      )}

      {households.length === 0 ? (
        <EmptyState
          title="Watch together"
          description="Make a household with a partner, family or roommates. You share one list, see each other's progress on a show, and log a watch for everyone in the room."
          action={<NewHouseholdForm />}
        />
      ) : (
        <>
          <section aria-labelledby="household-list">
            <SectionHeader id="household-list" title="Your households" className="mb-3" />
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {households.map((h) => (
                <HouseholdCard key={h.id} h={h} />
              ))}
            </div>
          </section>
          <div className="mt-10">
            <NewHouseholdForm />
          </div>
        </>
      )}
    </div>
  );
}
