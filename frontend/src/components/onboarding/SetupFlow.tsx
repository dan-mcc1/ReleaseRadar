import { useEffect, useState, type ReactNode } from "react";
import { BASE_IMAGE_URL } from "../../constants";
import type { Movie, Show } from "../../types/calendar";
import { usePopularMulti, useSearch } from "../../hooks/api/useSearch";
import { useUpdateWatchStatus } from "../../hooks/api/useWatchActions";
import { useToggleFavorite } from "../../hooks/api/useLists";
import {
  useAddStreamingService,
  useAllProviders,
  useMyProviderIds,
  useRemoveStreamingService,
} from "../../hooks/api/useStreamingServices";
import { Button, CheckIcon, HeartIcon, Modal, SearchField, cx, focusRing } from "../ui";

type Kind = "movie" | "tv";

export interface PickTitle {
  kind: Kind;
  id: number;
  name: string;
  posterPath: string | null;
}

const keyOf = (t: { kind: Kind; id: number }) => `${t.kind}:${t.id}`;

/** Popular or search results as one list, shows and movies alternating. */
function toTitles(movies: Movie[], shows: Show[], kinds: Kind[]): PickTitle[] {
  const ms = kinds.includes("movie") ? movies : [];
  const ss = kinds.includes("tv") ? shows : [];
  const out: PickTitle[] = [];
  for (let i = 0; i < Math.max(ms.length, ss.length); i++) {
    if (ss[i]) out.push({ kind: "tv", id: ss[i].id, name: ss[i].name, posterPath: ss[i].poster_path ?? null });
    if (ms[i]) out.push({ kind: "movie", id: ms[i].id, name: ms[i].title, posterPath: ms[i].poster_path ?? null });
  }
  return out;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const GRID = "grid grid-cols-3 sm:grid-cols-6 gap-3";

function PickTile({
  title,
  picked,
  mark,
  onToggle,
}: {
  title: PickTitle;
  picked: boolean;
  mark: ReactNode;
  onToggle: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        aria-pressed={picked}
        onClick={onToggle}
        className={cx("relative block w-full text-left rounded-surface cursor-pointer", focusRing)}
      >
        <span
          className={cx(
            "block aspect-[2/3] overflow-hidden rounded-surface bg-neutral-800 border transition-shadow",
            picked ? "border-primary-500 ring-2 ring-primary-500" : "border-white/10",
          )}
        >
          {title.posterPath ? (
            <img
              src={`${BASE_IMAGE_URL}/w185${title.posterPath}`}
              alt=""
              loading="lazy"
              className={cx("w-full h-full object-cover transition-opacity", !picked && "hover:opacity-85")}
            />
          ) : (
            <span className="flex h-full items-center justify-center p-2 text-center text-caption text-neutral-400">
              {title.name}
            </span>
          )}
        </span>
        {picked && (
          <span className="absolute top-1.5 right-1.5 flex size-6 items-center justify-center rounded-full bg-primary-500 text-neutral-950">
            {mark}
          </span>
        )}
        <span className="mt-1.5 block text-caption text-neutral-200 line-clamp-2">{title.name}</span>
      </button>
    </li>
  );
}

function TitlePicker({
  kinds,
  picked,
  exclude,
  mark,
  onToggle,
}: {
  kinds: Kind[];
  picked: Set<string>;
  exclude?: Set<string>;
  mark: ReactNode;
  onToggle: (t: PickTitle) => void;
}) {
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 300);
  const popular = usePopularMulti();
  const search = useSearch(q);
  const source = q ? search : popular;
  const titles = toTitles(source.data?.movies ?? [], source.data?.shows ?? [], kinds)
    .filter((t) => !exclude?.has(keyOf(t)))
    .slice(0, 18);

  return (
    <div className="flex flex-col gap-4">
      <SearchField
        label={kinds.length === 1 ? "Search shows" : "Search shows and movies"}
        placeholder={kinds.length === 1 ? "Search shows" : "Search shows and movies"}
        value={query}
        onChange={setQuery}
      />
      {source.isPending && (q || !source.data) ? (
        <ul className={GRID} aria-hidden="true">
          {Array.from({ length: 12 }, (_, i) => (
            <li key={i} className="aspect-[2/3] rounded-surface bg-neutral-800 animate-pulse" />
          ))}
        </ul>
      ) : titles.length === 0 ? (
        <p className="py-8 text-center text-body text-neutral-400">
          {q ? `Nothing found for "${q}".` : "Couldn't load suggestions. Try searching instead."}
        </p>
      ) : (
        <ul className={GRID} aria-label={q ? "Search results" : "Popular right now"}>
          {titles.map((t) => (
            <PickTile
              key={keyOf(t)}
              title={t}
              picked={picked.has(keyOf(t))}
              mark={mark}
              onToggle={() => onToggle(t)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

// Matched against provider names so the big services come first; the rest
// are a search away.
const POPULAR_SERVICES = ["netflix", "prime video", "disney", "max", "hulu", "apple tv", "paramount", "peacock", "crunchyroll"];

function ServicePicker() {
  const { data: providers, isPending } = useAllProviders();
  const mine = useMyProviderIds();
  const add = useAddStreamingService();
  const remove = useRemoveStreamingService();
  const [query, setQuery] = useState("");

  const q = query.trim().toLowerCase();
  const all = providers ?? [];
  const shown = q
    ? all.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 24)
    : POPULAR_SERVICES.map((n) => all.find((p) => p.name.toLowerCase().startsWith(n)))
        .filter((p): p is NonNullable<typeof p> => !!p)
        .concat(all.filter((p) => mine.has(p.id) && !POPULAR_SERVICES.some((n) => p.name.toLowerCase().startsWith(n))));

  return (
    <div className="flex flex-col gap-4">
      <SearchField label="Search services" placeholder="Search services" value={query} onChange={setQuery} />
      {isPending ? (
        <p className="py-8 text-center text-body text-neutral-400">Loading services…</p>
      ) : shown.length === 0 ? (
        <p className="py-8 text-center text-body text-neutral-400">No services match "{query.trim()}".</p>
      ) : (
        <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2" aria-label="Streaming services">
          {shown.map((p) => {
            const on = mine.has(p.id);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => (on ? remove.mutate(p.id) : add.mutate(p.id))}
                  className={cx(
                    "flex w-full items-center gap-3 rounded-control border px-3 py-2 text-left text-label cursor-pointer transition-colors",
                    on
                      ? "border-primary-500 bg-primary-500/10 text-neutral-50"
                      : "border-neutral-700 bg-neutral-900 text-neutral-200 hover:border-neutral-500",
                    focusRing,
                  )}
                >
                  {p.logo_path && (
                    <img src={`${BASE_IMAGE_URL}/w92${p.logo_path}`} alt="" className="size-8 rounded-md" />
                  )}
                  <span className="flex-1 truncate">{p.name}</span>
                  {on && <CheckIcon className="w-4 h-4 text-primary-400" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

const STEPS = [
  {
    id: "watching",
    title: "What are you watching right now?",
    description: "Pick the shows you're in the middle of. Their new episodes go straight onto your calendar.",
  },
  {
    id: "watchlist",
    title: "What do you want to watch?",
    description: "Save shows and movies for later. You'll hear when they premiere or arrive on your services.",
  },
  {
    id: "favorites",
    title: "Pick a few favorites",
    description: "Your all-time favorites show on your profile for friends to see.",
  },
  {
    id: "services",
    title: "Which streaming services do you have?",
    description: "We'll tell you when something on your list arrives on one of them.",
  },
  {
    id: "import",
    title: "Coming from Letterboxd?",
    description: "Bring your film history with you: watched films, ratings, dates and your watchlist.",
  },
] as const;

/**
 * First-run setup, before the tour: gets real titles onto a new account's
 * lists so the calendar and tour aren't empty. Every pick saves immediately
 * and can be undone by picking again; every step can be skipped.
 */
export default function SetupFlow({
  onFinish,
  onImport,
  busy = false,
}: {
  /** Setup done or skipped: start the tour. */
  onFinish: () => void;
  /** Leave for the Letterboxd import; the tour resumes afterwards. */
  onImport: () => void;
  busy?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [watching, setWatching] = useState<Set<string>>(new Set());
  const [watchlist, setWatchlist] = useState<Set<string>>(new Set());
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const updateStatus = useUpdateWatchStatus();
  const toggleFavorite = useToggleFavorite();

  function flip(set: Set<string>, k: string): Set<string> {
    const next = new Set(set);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  }

  // Save at once; on failure put the tile back and say so.
  // Functional updates throughout: a quick second pick must survive the
  // first one failing.
  function toggleList(
    t: PickTitle,
    picked: Set<string>,
    setPicked: (update: (s: Set<string>) => Set<string>) => void,
    status: "Currently Watching" | "Want To Watch",
  ) {
    const k = keyOf(t);
    const was = picked.has(k);
    setError(null);
    setPicked((s) => flip(s, k));
    updateStatus.mutate(
      {
        contentType: t.kind,
        contentId: t.id,
        currentStatus: was ? status : "none",
        targetStatus: was ? "none" : status,
      },
      {
        onError: () => {
          setPicked((s) => flip(s, k));
          setError(`Couldn't update ${t.name}. Try again.`);
        },
      },
    );
  }

  function toggleFav(t: PickTitle) {
    const k = keyOf(t);
    const was = favorites.has(k);
    setError(null);
    setFavorites((s) => flip(s, k));
    toggleFavorite.mutate(
      { contentType: t.kind, contentId: t.id, favorited: was },
      {
        onError: () => {
          setFavorites((s) => flip(s, k));
          setError(`Couldn't update ${t.name}. Try again.`);
        },
      },
    );
  }

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;
  const count =
    current.id === "watching"
      ? watching.size
      : current.id === "watchlist"
        ? watchlist.size
        : current.id === "favorites"
          ? favorites.size
          : null;

  return (
    <Modal
      open
      onClose={() => {
        if (!busy) onFinish();
      }}
      title={current.title}
      description={current.description}
      size="xl"
      footer={
        <>
          {!isLast && (
            <Button variant="ghost" onClick={onFinish} disabled={busy} className="mr-auto">
              Skip setup
            </Button>
          )}
          {step > 0 && (
            <Button onClick={() => setStep((s) => s - 1)} disabled={busy}>
              Back
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => (isLast ? onFinish() : setStep((s) => s + 1))}
            disabled={busy}
          >
            {isLast ? "Start the tour" : "Next"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-caption text-neutral-400 tabular" aria-live="polite">
        Step {step + 1} of {STEPS.length}
        {count !== null && ` · ${count} picked`}
      </p>

      {current.id === "watching" && (
        <TitlePicker
          kinds={["tv"]}
          picked={watching}
          mark={<CheckIcon className="w-3.5 h-3.5" />}
          onToggle={(t) => toggleList(t, watching, setWatching, "Currently Watching")}
        />
      )}
      {current.id === "watchlist" && (
        <TitlePicker
          kinds={["tv", "movie"]}
          picked={watchlist}
          exclude={watching}
          mark={<CheckIcon className="w-3.5 h-3.5" />}
          onToggle={(t) => toggleList(t, watchlist, setWatchlist, "Want To Watch")}
        />
      )}
      {current.id === "favorites" && (
        <TitlePicker
          kinds={["tv", "movie"]}
          picked={favorites}
          mark={<HeartIcon filled className="w-3.5 h-3.5" />}
          onToggle={toggleFav}
        />
      )}
      {current.id === "services" && <ServicePicker />}
      {current.id === "import" && (
        <div className="flex flex-col items-start gap-3 rounded-surface border border-neutral-800 bg-neutral-950 p-5">
          <p className="text-body text-neutral-300">
            Export your data from Letterboxd (Settings, then Import &amp; Export), then upload the
            ZIP here. It takes a few seconds. You can also do this later from Settings, under
            Account.
          </p>
          <Button onClick={onImport} disabled={busy}>
            Import from Letterboxd
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-4 text-label text-error-300">
          {error}
        </p>
      )}
    </Modal>
  );
}
