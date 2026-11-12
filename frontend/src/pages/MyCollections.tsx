import { useSearchParams } from "react-router-dom";
import {
  Button,
  ButtonLink,
  CheckIcon,
  EmptyState,
  PageHeader,
  PosterCard,
  SectionHeader,
  Segmented,
} from "../components/ui";
import { usePageTitle } from "../hooks/usePageTitle";
import { useAuthUser } from "../hooks/useAuthUser";
import {
  useMyCollections,
  type CollectionSummary,
  type MyCollectionCard,
} from "../hooks/api/useCollectionInfo";

type Filter = "all" | "in_progress" | "finished" | "favorites";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "favorites", label: "Favorites" },
  { value: "in_progress", label: "In progress" },
  { value: "finished", label: "Finished" },
];

function CollectionCard({ c }: { c: CollectionSummary }) {
  return <PosterCard to={`/collection/${c.id}`} title={c.name} posterPath={c.poster_path} />;
}

function ProgressCard({ c }: { c: MyCollectionCard }) {
  const total = c.released_parts ?? 0;
  const watched = c.watched_parts ?? 0;
  const pct = total > 0 ? Math.round((watched / total) * 100) : 0;

  return (
    <PosterCard
      to={`/collection/${c.id}`}
      title={c.name}
      posterPath={c.poster_path}
      footer={
        <div className="flex flex-col gap-1.5">
          <div className="h-1 bg-neutral-800 rounded-full overflow-hidden" aria-hidden="true">
            <div className="h-full bg-primary-500" style={{ width: `${pct}%` }} />
          </div>
          <p className="text-caption text-neutral-400 tabular">
            {watched} of {total} watched
          </p>
        </div>
      }
    />
  );
}

function FinishedCard({ c }: { c: MyCollectionCard }) {
  return (
    <PosterCard
      to={`/collection/${c.id}`}
      title={c.name}
      posterPath={c.poster_path}
      subtitle={
        <span className="inline-flex items-center gap-1">
          <CheckIcon className="w-3 h-3 text-success-400" />
          {c.released_parts
            ? `${c.released_parts} film${c.released_parts === 1 ? "" : "s"}`
            : "Finished"}
        </span>
      }
    />
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <section className="flex flex-col gap-4">
      <SectionHeader title={title} note={count} />
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-8 2xl:grid-cols-posters gap-4">
      {children}
    </div>
  );
}

export default function MyCollections() {
  usePageTitle("My collections");
  const user = useAuthUser();
  const { data, isPending, error, refetch } = useMyCollections(!!user);
  const [searchParams, setSearchParams] = useSearchParams();
  const filter = (searchParams.get("filter") as Filter) || "all";

  function setFilter(v: Filter) {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (v === "all") next.delete("filter");
        else next.set("filter", v);
        return next;
      },
      { replace: true },
    );
  }

  if (!user) {
    return (
      <EmptyState
        className="px-6 sm:px-10"
        title="Sign in to track your collections"
        action={
          <ButtonLink to="/signIn" variant="primary">
            Sign in
          </ButtonLink>
        }
      />
    );
  }

  if (isPending) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">Loading your collections…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <EmptyState
        title="Couldn't load your collections"
        description={error.message}
        action={<Button onClick={() => refetch()}>Try again</Button>}
      />
    );
  }

  const empty =
    (data?.favorites.length ?? 0) === 0 &&
    (data?.finished.length ?? 0) === 0 &&
    (data?.in_progress.length ?? 0) === 0;

  return (
    <div className="w-full px-6 sm:px-10 pt-6 pb-16 flex flex-col gap-8">
      <PageHeader
        title="My collections"
        description="Franchises and movie series you've favorited, finished, or are working through."
        actions={
          !empty && (
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={FILTERS.map(({ value, label }) => {
                const count =
                  value === "all"
                    ? (data?.in_progress.length ?? 0) +
                      (data?.finished.length ?? 0) +
                      (data?.favorites.length ?? 0)
                    : value === "in_progress"
                      ? data?.in_progress.length ?? 0
                      : value === "finished"
                        ? data?.finished.length ?? 0
                        : data?.favorites.length ?? 0;
                return {
                  value,
                  label: (
                    <>
                      {label}
                      <span className="ml-1.5 tabular text-neutral-500">{count}</span>
                    </>
                  ),
                };
              })}
            />
          )
        }
      />

      <div className="space-y-12">
        {empty && (
          <EmptyState
            title="You haven't started any collections yet"
            description="Favorite or watch a movie inside a collection to see it here."
            action={
              <ButtonLink to="/collections" variant="primary">
                Browse collections
              </ButtonLink>
            }
          />
        )}

        {(filter === "all" || filter === "favorites") && (
          <Section title="Favorites" count={data?.favorites.length ?? 0}>
            <Grid>
              {data?.favorites.map((c) => <CollectionCard key={c.id} c={c} />)}
            </Grid>
          </Section>
        )}

        {(filter === "all" || filter === "in_progress") && (
          <Section title="In progress" count={data?.in_progress.length ?? 0}>
            <Grid>
              {data?.in_progress.map((c) => <ProgressCard key={c.id} c={c} />)}
            </Grid>
          </Section>
        )}

        {(filter === "all" || filter === "finished") && (
          <Section title="Finished" count={data?.finished.length ?? 0}>
            <Grid>
              {data?.finished.map((c) => <FinishedCard key={c.id} c={c} />)}
            </Grid>
          </Section>
        )}
      </div>
    </div>
  );
}
