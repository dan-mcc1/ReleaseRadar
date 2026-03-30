import { Provider, WatchProvider } from "../types/calendar";
import { BASE_IMAGE_URL } from "../constants";
import { getProviderUrl, getProviderDedupeKey } from "../utils/providerUrls";

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
}

interface ProviderCardProps {
  providerId: number;
  providerName: string;
  logoPath: string;
  fallbackUrl?: string;
}

function ProviderCard({
  providerId,
  providerName,
  logoPath,
  fallbackUrl,
}: ProviderCardProps) {
  const url = getProviderUrl(providerId) ?? fallbackUrl;

  const content = (
    <div className="flex flex-col items-center gap-2" title={providerName}>
      {logoPath && (
        <img
          src={`${BASE_IMAGE_URL}/w154${logoPath}`}
          alt={providerName}
          className="h-20 w-20 rounded"
        />
      )}
      <span className="text-sm">{providerName}</span>
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

export default function WhereToWatch({ providers }: WhereToWatchProps) {
  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold mb-3">Where to Watch</h2>
      {providers.flatrate && (
        <div className="mb-4">
          <h3 className="font-medium mb-2">Streaming</h3>
          <div className="flex gap-4 flex-wrap">
            {deduplicateProviders(providers.flatrate).map((p) => (
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
