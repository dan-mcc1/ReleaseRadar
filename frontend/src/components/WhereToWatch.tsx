import type { Provider, WatchProvider } from "../types/calendar";
import { BASE_IMAGE_URL } from "../constants";
import { getProviderUrl, getProviderDedupeKey } from "../utils/providerUrls";
import { safeHref } from "../utils/safeHref";
import { useMyProviderIds } from "../hooks/api/useStreamingServices";
import { useAuthUser } from "../hooks/useAuthUser";
import { CheckIcon, SectionHeader } from "./ui";

function deduplicateProviders(list: WatchProvider[]): WatchProvider[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const key = getProviderDedupeKey(p.provider_id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// Fixed-width cells so every logo lines up on the same grid whatever the name's length.
const GRID = "grid grid-cols-[repeat(auto-fill,4.5rem)] gap-x-3 gap-y-4";
const GROUP_LABEL = "text-caption text-neutral-400 mb-2.5";

interface WhereToWatchProps {
  providers: Provider;
  hideTitle?: boolean;
}

interface ProviderCardProps {
  providerId: number;
  providerName: string;
  logoPath: string;
  fallbackUrl?: string;
  owned?: boolean;
}

function ProviderCard({
  providerId,
  providerName,
  logoPath,
  fallbackUrl,
  owned = false,
}: ProviderCardProps) {
  const url = getProviderUrl(providerId) ?? fallbackUrl;

  const content = (
    <div className="flex flex-col gap-1.5" title={providerName}>
      {logoPath && (
        <div className="relative">
          <img
            src={`${BASE_IMAGE_URL}/w154${logoPath}`}
            alt=""
            loading="lazy"
            className={`block w-full aspect-square rounded-control transition-all ${owned ? "ring-2 ring-primary-500 ring-offset-2 ring-offset-neutral-950" : ""}`}
          />
          {owned && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center shadow">
              <CheckIcon className="w-3 h-3 text-white" />
            </span>
          )}
        </div>
      )}
      <span
        className={`text-caption leading-tight text-center line-clamp-2 ${owned ? "text-primary-400 font-medium" : "text-neutral-300"}`}
      >
        {providerName}
      </span>
    </div>
  );

  if (url) {
    return (
      <a href={safeHref(url)} target="_blank" rel="noopener noreferrer" key={providerId}>
        {content}
      </a>
    );
  }

  return <div key={providerId}>{content}</div>;
}

export default function WhereToWatch({ providers, hideTitle = false }: WhereToWatchProps) {
  const user = useAuthUser();
  const myProviderIds = useMyProviderIds();

  function sortOwned(list: WatchProvider[]) {
    if (!user) return list;
    return [...list].sort((a, b) => {
      const aOwned = myProviderIds.has(a.provider_id) ? 0 : 1;
      const bOwned = myProviderIds.has(b.provider_id) ? 0 : 1;
      return aOwned - bOwned;
    });
  }

  return (
    <div className={`space-y-5 ${hideTitle ? "mt-3" : "mt-8"}`}>
      {!hideTitle && <SectionHeader title="Where to watch" className="mb-3" />}
      {providers.flatrate && (
        <div>
          <h3 className={GROUP_LABEL}>Streaming</h3>
          <div className={GRID}>
            {sortOwned(deduplicateProviders(providers.flatrate)).map((p) => (
              <ProviderCard
                key={p.provider_id}
                providerId={p.provider_id}
                providerName={p.provider_name}
                logoPath={p.logo_path}
                fallbackUrl={providers.link}
                owned={myProviderIds.has(p.provider_id)}
              />
            ))}
          </div>
        </div>
      )}

      {providers.rent && (
        <div>
          <h3 className={GROUP_LABEL}>Rent</h3>
          <div className={GRID}>
            {deduplicateProviders(providers.rent).map((p) => (
              <ProviderCard
                key={p.provider_id}
                providerId={p.provider_id}
                providerName={p.provider_name}
                logoPath={p.logo_path}
                fallbackUrl={providers.link}
              />
            ))}
          </div>
        </div>
      )}

      {providers.buy && (
        <div>
          <h3 className={GROUP_LABEL}>Buy</h3>
          <div className={GRID}>
            {deduplicateProviders(providers.buy).map((p) => (
              <ProviderCard
                key={p.provider_id}
                providerId={p.provider_id}
                providerName={p.provider_name}
                logoPath={p.logo_path}
                fallbackUrl={providers.link}
              />
            ))}
          </div>
        </div>
      )}

      <p className="text-caption text-neutral-400">
        Availability data from{" "}
        <a
          href="https://www.justwatch.com"
          target="_blank"
          rel="noopener noreferrer"
          className="text-neutral-200 hover:text-white transition-colors"
        >
          JustWatch
        </a>
      </p>
    </div>
  );
}
