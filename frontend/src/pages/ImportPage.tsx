import { useState, useRef } from "react";
import { usePageTitle } from "../hooks/usePageTitle";
import { apiFetch } from "../utils/apiFetch";

type Source = "letterboxd" | "tvtime";

interface ImportResult {
  row?: number;
  title: string;
  tmdb_id?: number;
  media_type?: string;
  status: "imported" | "watchlisted" | "skipped" | "failed";
  reason?: string;
  rating?: number | null;
  watched_at?: string | null;
  episodes_added?: number;
}

interface ImportSummary {
  total: number;
  imported: number;
  watchlisted: number;
  skipped: number;
  failed: number;
  ratings_applied?: number;
  shows_with_episodes?: number;
  movies_imported?: number;
  movies_watchlisted?: number;
}

type Phase = "idle" | "uploading" | "done" | "error";

const SOURCES: {
  id: Source;
  label: string;
  endpoint: string;
  importedLabel: string;
  importingHint: string;
  instructions: {
    title: string;
    steps: string[];
    notes: string[];
  };
}[] = [
  {
    id: "letterboxd",
    label: "Letterboxd",
    endpoint: "/import/letterboxd",
    importedLabel: "Watched",
    importingHint:
      "Matching each film to TMDB — this may take a minute for large lists.",
    instructions: {
      title: "How to export from Letterboxd",
      steps: [
        "Go to letterboxd.com → Settings → Data",
        "Click Export your data — you'll receive a zip file",
        "Upload the zip directly, or unzip and upload individual CSV files",
      ],
      notes: [
        "watched.csv / diary.csv / ratings.csv / reviews.csv → watched history",
        "watchlist.csv → your watchlist",
        "Ratings and watch dates are preserved. Duplicates are skipped.",
      ],
    },
  },
  {
    id: "tvtime",
    label: "TV Time",
    endpoint: "/import/tvtime",
    importedLabel: "Items",
    importingHint:
      "Matching each title to TMDB and importing your watched movies, episodes, and watchlist.",
    instructions: {
      title: "How to export from TV Time",
      steps: [
        'Install the "TV Time Out" Chrome extension and open it while signed in to tvtime.com',
        "Click Export — it'll download a zip file for you",
        "Upload the zip file, or unzip it and upload the individual files",
        'You can also still upload the original TV Time "Personal Data" email zip by contacting TVTime',
      ],
      notes: [
        "Watched movies → added to your watched list",
        "Unwatched movies → added to your watchlist",
        "Watched episodes → tracked per-episode, with shows auto-completed when finished",
        "Shows with no watched episodes → added to your watchlist",
      ],
    },
  },
];

export default function ImportPage() {
  usePageTitle("Import");

  const [source, setSource] = useState<Source>("letterboxd");
  const [phase, setPhase] = useState<Phase>("idle");
  const [dragOver, setDragOver] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [results, setResults] = useState<ImportResult[]>([]);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "all" | "imported" | "watchlisted" | "skipped" | "failed"
  >("all");
  const inputRef = useRef<HTMLInputElement>(null);

  const active = SOURCES.find((s) => s.id === source)!;

  function pickFile(f: File) {
    const lower = f.name.toLowerCase();
    const jsonOk = source === "tvtime" && lower.endsWith(".json");
    if (!lower.endsWith(".csv") && !lower.endsWith(".zip") && !jsonOk) {
      setErrorMsg(
        source === "tvtime"
          ? "Please select a .csv, .json, or .zip file."
          : "Please select a .csv or .zip file.",
      );
      return;
    }
    setFile(f);
    setErrorMsg(null);
  }

  async function runImport() {
    if (!file) return;
    setPhase("uploading");
    setErrorMsg(null);

    const form = new FormData();
    form.append("file", file);

    try {
      const res = await apiFetch(active.endpoint, {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.detail ?? `Server error ${res.status}`);
      }
      const data = await res.json();
      setSummary(data.summary);
      setResults(data.results ?? []);
      setPhase("done");
    } catch (e: unknown) {
      setErrorMsg(e instanceof Error ? e.message : "Import failed.");
      setPhase("error");
    }
  }

  function reset() {
    setPhase("idle");
    setFile(null);
    setSummary(null);
    setResults([]);
    setErrorMsg(null);
    setFilter("all");
  }

  function switchSource(next: Source) {
    if (next === source) return;
    setSource(next);
    reset();
  }

  const visibleResults =
    filter === "all" ? results : results.filter((r) => r.status === filter);

  return (
    <div className="w-full max-w-3xl mx-auto px-4 py-8 space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Import your history</h1>
        <p className="text-sm text-neutral-400 mt-1">
          Bring your watch history and watchlist over from another tracker.
        </p>
      </div>

      {/* Source tabs */}
      <div className="flex gap-1 border-b border-neutral-700">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            onClick={() => switchSource(s.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              source === s.id
                ? "border-primary-500 text-primary-400"
                : "border-transparent text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* How-to */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-2xl p-5 space-y-2">
        <h2 className="text-sm font-semibold text-white">
          {active.instructions.title}
        </h2>
        <ol className="list-decimal list-inside space-y-1 text-sm text-neutral-400">
          {active.instructions.steps.map((step, i) => (
            <li key={i}>{step}</li>
          ))}
        </ol>
        <div className="mt-2 pt-2 border-t border-neutral-800 space-y-1">
          <p className="text-xs text-neutral-500 font-medium">
            What gets imported:
          </p>
          <ul className="text-xs text-neutral-500 space-y-0.5 list-disc list-inside">
            {active.instructions.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      </div>

      {phase === "idle" || phase === "error" ? (
        <div className="space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files[0];
              if (f) pickFile(f);
            }}
            onClick={() => inputRef.current?.click()}
            className={`border-2 border-dashed rounded-2xl p-12 text-center cursor-pointer transition-colors ${
              dragOver
                ? "border-primary-500 bg-primary-500/5"
                : file
                  ? "border-primary-600/50 bg-primary-600/5"
                  : "border-neutral-700 hover:border-neutral-500"
            }`}
          >
            <input
              ref={inputRef}
              type="file"
              accept={source === "tvtime" ? ".csv,.json,.zip" : ".csv,.zip"}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) pickFile(f);
              }}
            />
            <div className="flex flex-col items-center gap-3">
              <div
                className={`w-12 h-12 rounded-full flex items-center justify-center ${file ? "bg-primary-600/20" : "bg-neutral-800"}`}
              >
                <svg
                  className={`w-6 h-6 ${file ? "text-primary-400" : "text-neutral-500"}`}
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
                  />
                </svg>
              </div>
              {file ? (
                <div>
                  <p className="text-sm font-semibold text-primary-400">
                    {file.name}
                  </p>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {(file.size / 1024).toFixed(1)} KB — click to change
                  </p>
                </div>
              ) : (
                <div>
                  <p className="text-sm text-neutral-300">
                    Drop your {active.label} export here or{" "}
                    <span className="text-primary-400">browse</span>
                  </p>
                  <p className="text-xs text-neutral-600 mt-0.5">
                    {source === "tvtime"
                      ? ".zip export, .json, or .csv — max 20 MB"
                      : ".zip export or individual .csv, max 20 MB"}
                  </p>
                </div>
              )}
            </div>
          </div>

          {errorMsg && (
            <p className="text-sm text-error-400 bg-error-900/20 border border-error-700/30 rounded-xl px-4 py-3">
              {errorMsg}
            </p>
          )}

          <button
            onClick={runImport}
            disabled={!file}
            className="w-full py-3 rounded-xl bg-primary-600 hover:bg-primary-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            Import
          </button>
        </div>
      ) : phase === "uploading" ? (
        <div className="flex flex-col items-center gap-4 py-16">
          <div className="w-10 h-10 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <div className="text-center">
            <p className="text-white font-medium">Importing your data…</p>
            <p className="text-sm text-neutral-400 mt-1">
              {active.importingHint}
            </p>
          </div>
        </div>
      ) : (
        /* Done state */
        <div className="space-y-6">
          {/* Summary cards */}
          {summary && (
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-success-900/20 border border-success-700/30 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-success-400">
                  {summary.imported}
                </p>
                <p className="text-xs text-neutral-400 mt-0.5">
                  {active.importedLabel}
                </p>
              </div>
              <div className="bg-primary-900/20 border border-primary-700/30 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-primary-400">
                  {summary.watchlisted}
                </p>
                <p className="text-xs text-neutral-400 mt-0.5">Watchlisted</p>
              </div>
              <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-center">
                <p className="text-2xl font-bold text-neutral-400">
                  {summary.skipped}
                </p>
                <p className="text-xs text-neutral-400 mt-0.5">Skipped</p>
              </div>
              <div
                className={`rounded-xl p-4 text-center border ${summary.failed > 0 ? "bg-error-900/20 border-error-700/30" : "bg-neutral-900 border-neutral-800"}`}
              >
                <p
                  className={`text-2xl font-bold ${summary.failed > 0 ? "text-error-400" : "text-neutral-400"}`}
                >
                  {summary.failed}
                </p>
                <p className="text-xs text-neutral-400 mt-0.5">Failed</p>
              </div>
            </div>
          )}

          {source === "tvtime" && summary?.ratings_applied ? (
            <p className="text-xs text-neutral-500">
              Applied {summary.ratings_applied} rating
              {summary.ratings_applied === 1 ? "" : "s"} to finished shows.
            </p>
          ) : null}

          {/* Filter tabs */}
          <div className="flex gap-1 border-b border-neutral-700 overflow-x-auto">
            {(
              ["all", "imported", "watchlisted", "skipped", "failed"] as const
            ).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors capitalize whitespace-nowrap ${
                  filter === f
                    ? "border-primary-500 text-primary-400"
                    : "border-transparent text-neutral-400 hover:text-neutral-200"
                }`}
              >
                {f === "imported" ? active.importedLabel : f}{" "}
                {f !== "all" &&
                  summary &&
                  `(${f === "imported" ? summary.imported : f === "watchlisted" ? summary.watchlisted : summary[f]})`}
              </button>
            ))}
          </div>

          {/* Results list */}
          <div className="space-y-1.5 max-h-96 overflow-y-auto pr-1">
            {visibleResults.map((r, idx) => (
              <div
                key={r.row ?? `${r.title}-${idx}`}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm border ${
                  r.status === "imported"
                    ? "bg-success-900/10 border-success-700/20"
                    : r.status === "watchlisted"
                      ? "bg-primary-900/10 border-primary-700/20"
                      : r.status === "failed"
                        ? "bg-error-900/10 border-error-700/20"
                        : "bg-neutral-900 border-neutral-800"
                }`}
              >
                <span
                  className={`flex-shrink-0 w-2 h-2 rounded-full ${
                    r.status === "imported"
                      ? "bg-success-400"
                      : r.status === "watchlisted"
                        ? "bg-primary-400"
                        : r.status === "failed"
                          ? "bg-error-400"
                          : "bg-neutral-600"
                  }`}
                />
                <span className="flex-1 text-neutral-200 truncate">
                  {r.title}
                </span>
                {r.episodes_added != null && r.episodes_added > 0 && (
                  <span className="text-xs text-neutral-400 flex-shrink-0">
                    {r.episodes_added} ep{r.episodes_added === 1 ? "" : "s"}
                  </span>
                )}
                {r.status === "watchlisted" && (
                  <span className="text-xs text-primary-400 flex-shrink-0">
                    watchlist
                  </span>
                )}
                {r.rating != null && (
                  <span className="text-xs text-amber-400 flex-shrink-0">
                    ★ {r.rating}
                  </span>
                )}
                {r.watched_at && (
                  <span className="text-xs text-neutral-500 flex-shrink-0">
                    {r.watched_at}
                  </span>
                )}
                {r.reason && (
                  <span className="text-xs text-neutral-500 flex-shrink-0 italic">
                    {r.reason}
                  </span>
                )}
              </div>
            ))}
          </div>

          <button
            onClick={reset}
            className="text-sm text-primary-400 hover:text-primary-300 transition-colors"
          >
            ← Import another file
          </button>
        </div>
      )}
    </div>
  );
}
