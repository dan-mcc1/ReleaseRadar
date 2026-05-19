import { Provider, WatchProvider } from "../types/calendar";
import { BASE_IMAGE_URL } from "../constants";
import { getProviderUrl, getProviderDedupeKey } from "../utils/providerUrls";
import { useMyProviderIds } from "../hooks/api/useStreamingServices";
import { useAuthUser } from "../hooks/useAuthUser";

function deduplicateProviders(list: WatchProvider[]): WatchProvider[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    const key = getProviderDedupeKey(p.provider_id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

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
    <div className="flex flex-col items-center gap-2" title={providerName}>
      {logoPath && (
        <div className="relative">
          <img
            src={`${BASE_IMAGE_URL}/w154${logoPath}`}
            alt={providerName}
            className={`h-20 w-20 rounded transition-all ${owned ? "ring-2 ring-primary-500 ring-offset-2 ring-offset-neutral-900" : ""}`}
          />
          {owned && (
            <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-primary-500 rounded-full flex items-center justify-center shadow">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </span>
          )}
        </div>
      )}
      <span className={`text-sm ${owned ? "text-primary-400 font-medium" : ""}`}>{providerName}</span>
    </div>
  );

  if (url) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" key={providerId}>
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
    <div className="mt-8">
      {!hideTitle && <h2 className="text-xl font-semibold mb-3">Where to Watch</h2>}
      {providers.flatrate && (
        <div className="mb-4">
          <h3 className="font-medium mb-2">Streaming</h3>
          <div className="flex gap-4 flex-wrap">
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
        <div className="mb-4">
          <h3 className="font-medium mb-2">Rent</h3>
          <div className="flex gap-4 flex-wrap">
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
        <div className="mb-4">
          <h3 className="font-medium mb-2">Buy</h3>
          <div className="flex gap-4 flex-wrap">
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
    </div>
  );
}
