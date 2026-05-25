import { Link, useSearchParams } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
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

function PosterCard({ c }: { c: CollectionSummary }) {
  return (
    <Link to={`/collection/${c.id}`} className="group flex flex-col gap-2">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700/50 group-hover:border-neutral-600 transition-colors">
        {c.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w342${c.poster_path}`}
            alt={c.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center p-3 text-center">
            <span className="text-xs text-neutral-500 line-clamp-4">{c.name}</span>
          </div>
        )}
      </div>
      <span className="block text-sm font-semibold text-neutral-100 line-clamp-2 group-hover:text-primary-300 transition-colors leading-tight">
        {c.name}
      </span>
    </Link>
  );
}

function ProgressCard({ c }: { c: MyCollectionCard }) {
  const total = c.released_parts ?? 0;
  const watched = c.watched_parts ?? 0;
  const pct = total > 0 ? Math.round((watched / total) * 100) : 0;

  return (
    <Link to={`/collection/${c.id}`} className="group flex flex-col gap-2">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700/50 group-hover:border-neutral-600 transition-colors">
        {c.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w342${c.poster_path}`}
            alt={c.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center p-3 text-center">
            <span className="text-xs text-neutral-500 line-clamp-4">{c.name}</span>
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent p-2 pt-6">
          <div className="flex items-center justify-between text-[10px] font-mono text-white/85 mb-1">
            <span>
              {watched}/{total}
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div
              className="h-full bg-primary-500"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      </div>
      <span className="block text-sm font-semibold text-neutral-100 line-clamp-2 group-hover:text-primary-300 transition-colors leading-tight">
        {c.name}
      </span>
    </Link>
  );
}

function FinishedCard({ c }: { c: MyCollectionCard }) {
  return (
    <Link to={`/collection/${c.id}`} className="group flex flex-col gap-2">
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-neutral-800 border border-neutral-700/50 group-hover:border-neutral-600 transition-colors">
        {c.poster_path ? (
          <img
            src={`${BASE_IMAGE_URL}/w342${c.poster_path}`}
            alt={c.name}
            loading="lazy"
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="h-full w-full flex items-center justify-center p-3 text-center">
            <span className="text-xs text-neutral-500 line-clamp-4">{c.name}</span>
          </div>
        )}
        <div className="absolute top-1.5 right-1.5 bg-success-600/90 backdrop-blur-sm rounded-full p-1.5">
          <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
      </div>
      <div className="min-w-0">
        <span className="block text-sm font-semibold text-neutral-100 line-clamp-2 group-hover:text-primary-300 transition-colors leading-tight">
          {c.name}
        </span>
        {c.released_parts && (
          <span className="block text-xs text-neutral-500 mt-1">
            {c.released_parts} film{c.released_parts === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </Link>
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
    <section className="space-y-4">
      <div className="flex items-baseline gap-3">
        <h2 className="text-xl font-semibold text-neutral-100 tracking-tight">
          {title}
        </h2>
        <span className="font-mono text-xs text-neutral-500">{count}</span>
      </div>
      {children}
    </section>
  );
}

function Grid({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 lg:grid-cols-8 gap-4">
      {children}
    </div>
  );
}

export default function MyCollections() {
  usePageTitle("My collections");
  const user = useAuthUser();
  const { data, isPending, error } = useMyCollections(!!user);
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
      <div className="px-6 sm:px-10 py-16 text-center">
        <p className="text-neutral-400">Sign in to track your collections.</p>
      </div>
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
    return <p className="text-error-400 p-6">{error.message}</p>;
  }

  const empty =
    (data?.favorites.length ?? 0) === 0 &&
    (data?.finished.length ?? 0) === 0 &&
    (data?.in_progress.length ?? 0) === 0;

  return (
    <div className="min-h-full pb-16">
      <div className="px-6 sm:px-10 pt-7 pb-6">
        <div className="text-[11px] font-mono tracking-widest text-neutral-500 uppercase mb-2">
          Your library · Collections
        </div>
        <h1
          className="text-[2.6rem] font-light tracking-tight text-neutral-100 leading-none"
          style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}
        >
          My <em className="italic text-primary-400">collections</em>
        </h1>
        <p className="text-neutral-400 mt-3 text-sm max-w-xl">
          Franchises and movie series you've favorited, finished, or are working
          through.
        </p>
      </div>

      {/* Filter pills */}
      {!empty && (
        <div className="px-6 sm:px-10 pb-6">
          <div className="flex bg-neutral-800 border border-neutral-700 rounded-xl p-1 w-fit">
            {FILTERS.map(({ value, label }) => {
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
              const active = filter === value;
              return (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-all flex items-center gap-1.5 ${
                    active
                      ? "bg-neutral-700 text-neutral-100 shadow-sm"
                      : "text-neutral-400 hover:text-neutral-200"
                  }`}
                >
                  {label}
                  <span
                    className={`font-mono text-[11px] ${
                      active ? "text-neutral-400" : "text-neutral-500"
                    }`}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="px-6 sm:px-10 space-y-12">
        {empty && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <p className="text-neutral-300 font-medium mb-1">
              You haven't started any collections yet
            </p>
            <p className="text-neutral-500 text-sm">
              <Link to="/collections" className="text-primary-400 hover:underline">
                Browse collections
              </Link>{" "}
              and favorite or watch a movie inside one to see it here.
            </p>
          </div>
        )}

        {(filter === "all" || filter === "favorites") && (
          <Section title="Favorites" count={data?.favorites.length ?? 0}>
            <Grid>
              {data?.favorites.map((c) => <PosterCard key={c.id} c={c} />)}
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
