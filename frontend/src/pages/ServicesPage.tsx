import { useState } from "react";
import { Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import { usePageTitle } from "../hooks/usePageTitle";
import {
  useServicePopular,
  useServicesOverview,
  useSetServicePaused,
  type ServiceOverview,
  type ServiceRelease,
  type ServiceVerdict,
} from "../hooks/api/useStreamingServices";
import StreamingOptimizer from "../components/StreamingOptimizer";
import { useToast } from "../components/Toast";
import {
  Button,
  ButtonLink,
  Card,
  ChevronDownIcon,
  EmptyState,
  PageHeader,
  PageState,
  PosterCard,
  SectionHeader,
  cx,
  moreLinkClass,
} from "../components/ui";
import { agoLabel, releaseLabel, verdictLine, whenLabel } from "../utils/services";

const VERDICT_CHIP: Record<ServiceVerdict, { label: string; classes: string }> = {
  keep: { label: "Worth keeping", classes: "bg-success-500/15 text-success-300 border-success-500/30" },
  pause: { label: "Worth pausing", classes: "bg-warning-500/15 text-warning-300 border-warning-500/30" },
  paused: { label: "Paused", classes: "bg-neutral-800 text-neutral-300 border-neutral-700" },
};

// Services that want attention first: pausable, then active, then paused.
const ORDER: Record<ServiceVerdict, number> = { pause: 0, keep: 1, paused: 2 };

function titlePath(t: { content_type: "tv" | "movie"; id: number }) {
  return `/${t.content_type}/${t.id}`;
}

function ServiceLogo({ s }: { s: ServiceOverview }) {
  return s.logo_path ? (
    <img
      src={`${BASE_IMAGE_URL}/w92${s.logo_path}`}
      alt=""
      className="size-12 rounded-control object-cover flex-shrink-0 border border-white/10"
    />
  ) : (
    <div className="size-12 rounded-control bg-neutral-800 flex-shrink-0" aria-hidden="true" />
  );
}

function ReleaseRow({ r }: { r: ServiceRelease }) {
  return (
    <li>
      <Link
        to={titlePath(r)}
        className="flex items-center gap-3 rounded-control py-1.5 hover:bg-white/5 transition-colors"
      >
        {r.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w92${r.poster_path}`}
            alt=""
            loading="lazy"
            className="w-9 h-[54px] rounded object-cover flex-shrink-0 border border-white/10"
          />
        ) : (
          <div className="w-9 h-[54px] rounded bg-neutral-800 flex-shrink-0" aria-hidden="true" />
        )}
        <div className="flex-1 min-w-0">
          <p className="truncate text-label font-semibold text-neutral-100">{r.title}</p>
          <p className="truncate text-caption text-neutral-400">{releaseLabel(r)}</p>
        </div>
        <time dateTime={r.date} className="text-caption text-neutral-300 tabular flex-shrink-0">
          {whenLabel(r.date)}
        </time>
      </Link>
    </li>
  );
}

function PopularRail({ s }: { s: ServiceOverview }) {
  const { data, isPending, isError } = useServicePopular(s.id, true);
  if (isPending) {
    return <p className="text-caption text-neutral-400 py-4">Loading what's popular…</p>;
  }
  if (isError) {
    return <p className="text-caption text-neutral-400 py-4">Couldn't load popular titles right now.</p>;
  }
  if (!data?.length) {
    return <p className="text-caption text-neutral-400 py-4">Nothing to suggest: you've got the popular ones covered.</p>;
  }
  return (
    <div className="grid grid-flow-col auto-cols-[7rem] sm:auto-cols-[8rem] gap-3 overflow-x-auto pb-2 -mx-1 px-1">
      {data.map((t) => (
        <PosterCard
          key={`${t.content_type}-${t.id}`}
          to={titlePath(t)}
          title={t.title}
          posterPath={t.poster_path}
          posterSize="w185"
          subtitle={[t.content_type === "tv" ? "Series" : "Movie", t.year].filter(Boolean).join(" · ")}
        />
      ))}
    </div>
  );
}

function ServiceCard({
  s,
  lookaheadDays,
  recentDays,
}: {
  s: ServiceOverview;
  lookaheadDays: number;
  recentDays: number;
}) {
  const setPaused = useSetServicePaused();
  const toast = useToast();
  const quiet = s.verdict !== "keep";
  const [showPopular, setShowPopular] = useState(quiet);
  const chip = VERDICT_CHIP[s.verdict];
  const paused = s.verdict === "paused";

  const togglePause = () =>
    setPaused.mutate(
      { providerId: s.id, paused: !paused },
      {
        onSuccess: () =>
          toast.success(paused ? `${s.name} marked as active` : `${s.name} marked as paused`),
        onError: () => toast.error("Couldn't save that. Try again."),
      },
    );

  return (
    <Card as="article" padding="md" aria-labelledby={`service-${s.id}`} className="flex flex-col gap-5">
      {/* Header: who, the verdict, and the one action */}
      <div className="flex items-start gap-4">
        <ServiceLogo s={s} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id={`service-${s.id}`} className="text-title font-semibold text-neutral-100">
              {s.name}
            </h2>
            <span className={cx("text-caption font-semibold px-2 py-0.5 rounded-full border", chip.classes)}>
              {chip.label}
            </span>
          </div>
          <p className="mt-1 text-body text-neutral-300">{verdictLine(s, lookaheadDays, recentDays)}</p>
          {s.last_used && (
            <p className="mt-1 text-caption text-neutral-400">
              Last used {agoLabel(s.last_used.at)}:{" "}
              <Link to={titlePath(s.last_used)} className="text-neutral-300 hover:text-primary-300 transition-colors">
                {s.last_used.title}
              </Link>
            </p>
          )}
        </div>
        <Button
          size="sm"
          onClick={togglePause}
          loading={setPaused.isPending}
          disabled={setPaused.isPending}
          className="flex-shrink-0"
        >
          {paused ? "Resume" : "Mark as paused"}
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5">
        {/* Coming up */}
        <section aria-label={`Coming to ${s.name}`}>
          <SectionHeader
            as="h3"
            title="Coming up"
            note={s.upcoming_count > s.upcoming.length ? `${s.upcoming_count} in all` : undefined}
            className="mb-2"
          />
          {s.upcoming.length > 0 ? (
            <ul className="flex flex-col">
              {s.upcoming.map((r) => (
                <ReleaseRow key={`${r.content_type}-${r.id}`} r={r} />
              ))}
            </ul>
          ) : (
            <p className="text-caption text-neutral-400">
              Nothing from your list in the next {Math.round(lookaheadDays / 30)} months.
            </p>
          )}
        </section>

        {/* Ready now */}
        <section aria-label={`Ready to watch on ${s.name}`}>
          <SectionHeader
            as="h3"
            title="Ready now"
            note={s.ready_now.count > 0 ? `${s.ready_now.count} on your list` : undefined}
            className="mb-2"
          />
          {s.ready_now.count > 0 ? (
            <div className="flex flex-wrap gap-2">
              {s.ready_now.items.map((t) => (
                <Link
                  key={`${t.content_type}-${t.id}`}
                  to={titlePath(t)}
                  title={t.title}
                  className="block rounded hover:opacity-85 transition-opacity"
                >
                  {t.poster_path ? (
                    <img
                      src={`${BASE_IMAGE_URL}/w92${t.poster_path}`}
                      alt={t.title}
                      loading="lazy"
                      className="w-12 h-[72px] rounded object-cover border border-white/10"
                    />
                  ) : (
                    <span className="w-12 h-[72px] rounded bg-neutral-800 flex items-center justify-center p-1 text-center text-caption text-neutral-400 line-clamp-3">
                      {t.title}
                    </span>
                  )}
                </Link>
              ))}
            </div>
          ) : (
            <p className="text-caption text-neutral-400">Nothing on your Watchlist streams here yet.</p>
          )}
        </section>
      </div>

      {/* Popular on the service: open by default when it's quiet */}
      <section aria-label={`Popular on ${s.name}`}>
        <button
          type="button"
          onClick={() => setShowPopular((v) => !v)}
          aria-expanded={showPopular}
          className={cx(moreLinkClass, "inline-flex items-center gap-1")}
        >
          {quiet ? `Make the most of ${s.name}: popular titles` : `Popular on ${s.name}`}
          <ChevronDownIcon className={cx("w-4 h-4 transition-transform", showPopular && "rotate-180")} />
        </button>
        {showPopular && (
          <div className="mt-3">
            <PopularRail s={s} />
          </div>
        )}
      </section>
    </Card>
  );
}

export default function ServicesPage() {
  usePageTitle("My services");
  const { data, isPending, error, refetch } = useServicesOverview();

  if (isPending) return <PageState status="loading" label="Checking your services…" />;
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

  const services = [...data.services].sort((a, b) => ORDER[a.verdict] - ORDER[b.verdict]);
  const pausable = services.filter((s) => s.verdict === "pause").length;
  const paused = services.filter((s) => s.verdict === "paused").length;
  const summary = [
    `${services.length} ${services.length === 1 ? "service" : "services"}`,
    pausable > 0 ? `${pausable} you could pause` : null,
    paused > 0 ? `${paused} paused` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-8">
      <PageHeader
        title="My services"
        description={
          services.length > 0
            ? summary
            : "See what's coming to the streaming services you pay for."
        }
        actions={
          <ButtonLink to="/settings#streaming" size="sm">
            Manage services
          </ButtonLink>
        }
        className="mb-6"
      />

      {services.length === 0 ? (
        <EmptyState
          title="Add the services you pay for"
          description="Pick your streaming services and ReleaseRadar will show what's coming to each, which ones you're not using, and when it's worth resubscribing."
          action={
            <ButtonLink to="/settings#streaming" variant="primary">
              Choose services
            </ButtonLink>
          }
        />
      ) : (
        <div className="flex flex-col gap-4">
          {services.map((s) => (
            <ServiceCard
              key={s.id}
              s={s}
              lookaheadDays={data.lookahead_days}
              recentDays={data.recent_use_days}
            />
          ))}
        </div>
      )}

      <section className="mt-12" aria-labelledby="cover-list">
        <SectionHeader
          id="cover-list"
          title="Cover the rest of your list"
          note="which services carry the titles you're waiting on"
          divider
          className="mb-4"
        />
        <StreamingOptimizer />
      </section>

      <p className="mt-10 text-caption text-neutral-500 max-w-2xl">
        Streaming availability is for the US. Movies show up once they're streaming, since services
        don't announce those dates ahead. Marking a service as paused doesn't change your
        subscription: it tells ReleaseRadar to remind you a week before something from your list
        premieres there.
      </p>
    </div>
  );
}
