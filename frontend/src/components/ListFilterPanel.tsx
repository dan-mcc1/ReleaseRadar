import type { Movie, Show } from "../types/calendar";

export interface ListFilters {
  genres: string[];
  certifications: string[];
  yearMin: string;
  yearMax: string;
  tmdbRatingMin: string;
  userRatings: number[]; // exact star values (1-5); 0 = unrated
  myServicesOnly: boolean;
}

export const DEFAULT_FILTERS: ListFilters = {
  genres: [],
  certifications: [],
  yearMin: "",
  yearMax: "",
  tmdbRatingMin: "",
  userRatings: [],
  myServicesOnly: false,
};

export function countActiveFilters(f: ListFilters): number {
  return (
    (f.genres.length > 0 ? 1 : 0) +
    (f.certifications.length > 0 ? 1 : 0) +
    (f.yearMin || f.yearMax ? 1 : 0) +
    (f.tmdbRatingMin ? 1 : 0) +
    (f.userRatings.length > 0 ? 1 : 0) +
    (f.myServicesOnly ? 1 : 0)
  );
}

export function applyFilters<T extends Movie | Show>(
  items: T[],
  f: ListFilters,
  myProviderIds?: Set<number>,
): T[] {
  if (countActiveFilters(f) === 0) return items;
  return items.filter((item) => {
    if (f.genres.length > 0) {
      const names = item.genres?.map((g) => g.name) ?? [];
      if (!f.genres.some((g) => names.includes(g))) return false;
    }
    if (f.certifications.length > 0) {
      if (!item.certification || !f.certifications.includes(item.certification)) return false;
    }
    const rawDate = "release_date" in item ? item.release_date : item.first_air_date;
    const year = rawDate ? parseInt(rawDate.slice(0, 4), 10) : null;
    if (f.yearMin && (year === null || year < parseInt(f.yearMin, 10))) return false;
    if (f.yearMax && (year === null || year > parseInt(f.yearMax, 10))) return false;
    if (f.tmdbRatingMin && (item.vote_average == null || item.vote_average < parseFloat(f.tmdbRatingMin))) return false;
    if (f.userRatings.length > 0) {
      // 0 is the sentinel for "unrated"; otherwise match the exact star value
      const rating = item.user_rating ?? 0;
      if (!f.userRatings.includes(Math.round(rating))) return false;
    }
    if (f.myServicesOnly && myProviderIds && myProviderIds.size > 0) {
      const ids = item.flatrate_provider_ids ?? [];
      if (!ids.some((id) => myProviderIds.has(id))) return false;
    }
    return true;
  });
}

const CERT_ORDER = [
  "G", "PG", "PG-13", "R", "NC-17", "NR",
  "TV-Y", "TV-Y7", "TV-G", "TV-PG", "TV-14", "TV-MA",
];

const TMDB_OPTIONS = [
  { label: "Any", value: "" },
  { label: "6+", value: "6" },
  { label: "7+", value: "7" },
  { label: "7.5+", value: "7.5" },
  { label: "8+", value: "8" },
  { label: "8.5+", value: "8.5" },
];

interface Props {
  filters: ListFilters;
  onChange: (f: ListFilters) => void;
  availableGenres: string[];
  availableCertifications: string[];
  showUserRating?: boolean;
  hasMyServices?: boolean;
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-xs px-2.5 py-1 rounded-full border transition-colors whitespace-nowrap ${
        active
          ? "bg-primary-600/30 border-primary-500 text-primary-300"
          : "bg-neutral-700/50 border-neutral-600 text-neutral-400 hover:border-neutral-500 hover:text-neutral-300"
      }`}
    >
      {children}
    </button>
  );
}

export default function ListFilterPanel({
  filters,
  onChange,
  availableGenres,
  availableCertifications,
  showUserRating = false,
  hasMyServices = false,
}: Props) {
  const sortedCerts = [...availableCertifications].sort((a, b) => {
    const ai = CERT_ORDER.indexOf(a);
    const bi = CERT_ORDER.indexOf(b);
    return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
  });

  const currentYear = new Date().getFullYear();

  function toggleGenre(g: string) {
    onChange({
      ...filters,
      genres: filters.genres.includes(g)
        ? filters.genres.filter((x) => x !== g)
        : [...filters.genres, g],
    });
  }

  function toggleCert(c: string) {
    onChange({
      ...filters,
      certifications: filters.certifications.includes(c)
        ? filters.certifications.filter((x) => x !== c)
        : [...filters.certifications, c],
    });
  }

  function toggleUserRating(s: number) {
    onChange({
      ...filters,
      userRatings: filters.userRatings.includes(s)
        ? filters.userRatings.filter((x) => x !== s)
        : [...filters.userRatings, s],
    });
  }

  const hasActive = countActiveFilters(filters) > 0;

  return (
    <div className="bg-neutral-800/50 border border-neutral-700 rounded-xl p-4 space-y-4">
      {/* My Services toggle */}
      {hasMyServices && (
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold text-neutral-300">On My Services</p>
            <p className="text-xs text-neutral-500">Only show titles available on streaming services you have</p>
          </div>
          <button
            type="button"
            onClick={() => onChange({ ...filters, myServicesOnly: !filters.myServicesOnly })}
            className={`relative inline-flex h-6 w-12 shrink-0 items-center rounded-full transition-colors ${
              filters.myServicesOnly ? "bg-primary-600" : "bg-neutral-600"
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                filters.myServicesOnly ? "translate-x-7" : "translate-x-1"
              }`}
            />
          </button>
        </div>
      )}

      {/* Genres */}
      {availableGenres.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Genre
          </p>
          <div className="flex flex-wrap gap-1.5">
            {availableGenres.map((g) => (
              <Pill key={g} active={filters.genres.includes(g)} onClick={() => toggleGenre(g)}>
                {g}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Certifications */}
      {sortedCerts.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Content Rating
          </p>
          <div className="flex flex-wrap gap-1.5">
            {sortedCerts.map((c) => (
              <Pill
                key={c}
                active={filters.certifications.includes(c)}
                onClick={() => toggleCert(c)}
              >
                {c}
              </Pill>
            ))}
          </div>
        </div>
      )}

      {/* Year / TMDB Score / User Rating row */}
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        {/* Year range */}
        <div>
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            Year
          </p>
          <div className="flex items-center gap-2">
            <input
              type="number"
              value={filters.yearMin}
              onChange={(e) => onChange({ ...filters, yearMin: e.target.value })}
              placeholder="From"
              min={1900}
              max={currentYear + 5}
              className="w-20 bg-neutral-700 border border-neutral-600 text-neutral-200 placeholder-neutral-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
            />
            <span className="text-neutral-600 text-xs">–</span>
            <input
              type="number"
              value={filters.yearMax}
              onChange={(e) => onChange({ ...filters, yearMax: e.target.value })}
              placeholder="To"
              min={1900}
              max={currentYear + 5}
              className="w-20 bg-neutral-700 border border-neutral-600 text-neutral-200 placeholder-neutral-600 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:border-neutral-500"
            />
          </div>
        </div>

        {/* TMDB Score */}
        <div>
          <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
            TMDB Score
          </p>
          <div className="flex flex-wrap gap-1.5">
            {TMDB_OPTIONS.map((opt) => (
              <Pill
                key={opt.value}
                active={filters.tmdbRatingMin === opt.value}
                onClick={() => onChange({ ...filters, tmdbRatingMin: opt.value })}
              >
                {opt.label}
              </Pill>
            ))}
          </div>
        </div>

        {/* User Rating (Watched only) — multi-select exact match */}
        {showUserRating && (
          <div>
            <p className="text-xs font-semibold text-neutral-400 uppercase tracking-wider mb-2">
              My Rating
            </p>
            <div className="flex gap-1.5 flex-wrap">
              {[1, 2, 3, 4, 5].map((s) => (
                <Pill
                  key={s}
                  active={filters.userRatings.includes(s)}
                  onClick={() => toggleUserRating(s)}
                >
                  {"★".repeat(s)}
                </Pill>
              ))}
              <Pill
                active={filters.userRatings.includes(0)}
                onClick={() => toggleUserRating(0)}
              >
                Unrated
              </Pill>
            </div>
          </div>
        )}
      </div>

      {hasActive && (
        <button
          type="button"
          onClick={() => onChange(DEFAULT_FILTERS)}
          className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors"
        >
          Clear all filters
        </button>
      )}
    </div>
  );
}
