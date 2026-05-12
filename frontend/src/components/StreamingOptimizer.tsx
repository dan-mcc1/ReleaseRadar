import { useState } from "react";
import { useStreamingOptimizer, type OptimizerItem } from "../hooks/api/useStreamingServices";
import { BASE_IMAGE_URL } from "../constants";

function ProviderLogo({
  logoPath,
  name,
  size = 48,
}: {
  logoPath: string | null;
  name: string;
  size?: number;
}) {
  if (!logoPath) return null;
  return (
    <img
      src={`${BASE_IMAGE_URL}/w92${logoPath}`}
      alt={name}
      title={name}
      style={{ width: size, height: size }}
      className="rounded-xl object-cover"
    />
  );
}

function ItemPoster({ item }: { item: OptimizerItem }) {
  const to = item.type === "tv" ? `/show/${item.id}` : `/movie/${item.id}`;
  return (
    <a href={to} title={item.title} className="shrink-0 group">
      {item.poster_path ? (
        <img
          src={`${BASE_IMAGE_URL}/w92${item.poster_path}`}
          alt={item.title}
          className="w-9 h-13 rounded object-cover group-hover:ring-2 group-hover:ring-primary-400 transition-all"
          style={{ height: 52 }}
        />
      ) : (
        <div
          className="w-9 rounded bg-neutral-700 flex items-center justify-center text-neutral-500 text-xs"
          style={{ height: 52 }}
        >
          ?
        </div>
      )}
    </a>
  );
}

function CoverageBar({
  covered,
  total,
}: {
  covered: number;
  total: number;
}) {
  const pct = total === 0 ? 0 : Math.round((covered / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-sm mb-1.5">
        <span className="text-white font-medium">
          {covered} of {total} items covered
        </span>
        <span className="text-neutral-400">{pct}%</span>
      </div>
      <div className="h-2 bg-neutral-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary-500 rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function StreamingOptimizer() {
  const { data, isLoading, error } = useStreamingOptimizer();
  const [showAllProviders, setShowAllProviders] = useState(false);
  const [showUncovered, setShowUncovered] = useState(false);
  const [showNoStreaming, setShowNoStreaming] = useState(false);

  if (isLoading) {
    return (
      <div className="bg-neutral-800 shadow-md rounded-lg p-4">
        <div className="flex items-center gap-2 text-neutral-400 text-sm">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Analyzing your watchlist…
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="bg-neutral-800 shadow-md rounded-lg p-4">
        <p className="text-neutral-400 text-sm">Could not load optimizer. Try again later.</p>
      </div>
    );
  }

  if (data.total_items === 0) {
    return (
      <div className="bg-neutral-800 shadow-md rounded-lg p-4">
        <p className="text-neutral-400 text-sm">Add items to your watchlist to see streaming coverage.</p>
      </div>
    );
  }

  const visibleProviders = showAllProviders
    ? data.coverage_by_provider
    : data.coverage_by_provider.slice(0, 8);

  const visibleUncovered = showUncovered
    ? data.uncovered_items
    : data.uncovered_items.slice(0, 6);

  const visibleNoStreaming = showNoStreaming
    ? data.no_streaming_items
    : data.no_streaming_items.slice(0, 6);

  const suggestionsNotOwned = data.suggested_combo.filter((s) => !s.you_have);

  return (
    <div className="space-y-4">
      {/* Coverage overview */}
      <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-4">
        <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
          Coverage Overview
        </h2>
        <CoverageBar covered={data.my_services_coverage} total={data.total_items} />
        <div className="flex gap-4 text-xs text-neutral-500">
          <span>
            <span className="text-neutral-300">{data.items_with_streaming}</span> available on streaming
          </span>
          <span>
            <span className="text-neutral-300">{data.no_streaming_items.length}</span> not on any service
          </span>
        </div>
      </div>

      {/* Suggested additions */}
      {suggestionsNotOwned.length > 0 && (
        <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
              Recommended Services
            </h2>
            <p className="text-neutral-500 text-xs mt-0.5">
              Add these to maximize your watchlist coverage
            </p>
          </div>
          <div className="space-y-2">
            {suggestionsNotOwned.map((s) => (
              <div
                key={s.id}
                className="flex items-center gap-3 bg-neutral-700/50 rounded-lg px-3 py-2.5"
              >
                <ProviderLogo logoPath={s.logo_path} name={s.name} size={40} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{s.name}</p>
                  <p className="text-primary-400 text-xs">
                    +{s.adds_count} item{s.adds_count !== 1 ? "s" : ""} covered
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All providers ranked */}
      {data.coverage_by_provider.length > 0 && (
        <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-3">
          <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
            All Services by Coverage
          </h2>
          <div className="space-y-2">
            {visibleProviders.map((p) => {
              const pct =
                data.total_items === 0 ? 0 : Math.round((p.count / data.total_items) * 100);
              return (
                <div key={p.id} className="flex items-center gap-3">
                  <ProviderLogo logoPath={p.logo_path} name={p.name} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between text-xs mb-1">
                      <span className={`font-medium ${p.you_have ? "text-white" : "text-neutral-400"}`}>
                        {p.name}
                        {p.you_have && (
                          <span className="ml-1.5 text-primary-400 text-xs">✓ yours</span>
                        )}
                      </span>
                      <span className="text-neutral-500 tabular-nums">
                        {p.count}/{data.total_items}
                      </span>
                    </div>
                    <div className="h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${p.you_have ? "bg-primary-500" : "bg-neutral-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          {data.coverage_by_provider.length > 8 && (
            <button
              onClick={() => setShowAllProviders((v) => !v)}
              className="text-xs text-primary-400 hover:text-primary-300"
            >
              {showAllProviders
                ? "Show less"
                : `Show ${data.coverage_by_provider.length - 8} more`}
            </button>
          )}
        </div>
      )}

      {/* Items not covered by your services */}
      {data.uncovered_items.length > 0 && (
        <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
              Not Covered by Your Services
            </h2>
            <p className="text-neutral-500 text-xs mt-0.5">
              {data.uncovered_items.length} item{data.uncovered_items.length !== 1 ? "s" : ""} available on other services
            </p>
          </div>
          <div className="space-y-2">
            {visibleUncovered.map((item) => (
              <div key={`${item.type}-${item.id}`} className="flex items-center gap-3">
                <ItemPoster item={item} />
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">{item.title}</p>
                  {item.available_on && item.available_on.length > 0 ? (
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      {item.available_on.slice(0, 4).map((p) => (
                        <img
                          key={p.id}
                          src={`${BASE_IMAGE_URL}/w45${p.logo_path}`}
                          alt={p.name}
                          title={p.name}
                          className="w-5 h-5 rounded object-cover"
                        />
                      ))}
                      {item.available_on.length > 4 && (
                        <span className="text-neutral-500 text-xs">
                          +{item.available_on.length - 4} more
                        </span>
                      )}
                    </div>
                  ) : (
                    <p className="text-neutral-500 text-xs mt-0.5">Not on any service</p>
                  )}
                </div>
              </div>
            ))}
          </div>
          {data.uncovered_items.length > 6 && (
            <button
              onClick={() => setShowUncovered((v) => !v)}
              className="text-xs text-primary-400 hover:text-primary-300"
            >
              {showUncovered
                ? "Show less"
                : `Show ${data.uncovered_items.length - 6} more`}
            </button>
          )}
        </div>
      )}

      {/* Items with no streaming option */}
      {data.no_streaming_items.length > 0 && (
        <div className="bg-neutral-800 shadow-md rounded-lg p-4 space-y-3">
          <div>
            <h2 className="text-sm font-semibold text-neutral-400 uppercase tracking-wider">
              Not Available to Stream
            </h2>
            <p className="text-neutral-500 text-xs mt-0.5">
              {data.no_streaming_items.length} item{data.no_streaming_items.length !== 1 ? "s" : ""} with no flatrate streaming option
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {visibleNoStreaming.map((item) => (
              <a
                key={`${item.type}-${item.id}`}
                href={item.type === "tv" ? `/show/${item.id}` : `/movie/${item.id}`}
                className="flex items-center gap-2 bg-neutral-700/40 rounded-lg px-2 py-1.5 hover:bg-neutral-700 transition-colors"
              >
                {item.poster_path ? (
                  <img
                    src={`${BASE_IMAGE_URL}/w45${item.poster_path}`}
                    alt={item.title}
                    className="w-6 h-9 rounded object-cover shrink-0"
                  />
                ) : (
                  <div className="w-6 h-9 rounded bg-neutral-600 shrink-0" />
                )}
                <span className="text-neutral-300 text-xs truncate">{item.title}</span>
              </a>
            ))}
          </div>
          {data.no_streaming_items.length > 6 && (
            <button
              onClick={() => setShowNoStreaming((v) => !v)}
              className="text-xs text-primary-400 hover:text-primary-300"
            >
              {showNoStreaming
                ? "Show less"
                : `Show ${data.no_streaming_items.length - 6} more`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
