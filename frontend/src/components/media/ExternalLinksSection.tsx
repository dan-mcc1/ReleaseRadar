// frontend/src/components/media/ExternalLinksSection.tsx
import { ExternalLink } from "../InfoPageWidgets";
import type { MediaExternalIds } from "../../types/media";

interface Props {
  externalIds: MediaExternalIds;
}

export default function ExternalLinksSection({ externalIds }: Props) {
  return (
    <div>
      <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-3">External Links</h2>
      <div className="flex flex-wrap gap-2">
        {externalIds.imdb_id && (
          <ExternalLink href={`https://www.imdb.com/title/${externalIds.imdb_id}`} label="IMDb" />
        )}
        {externalIds.tvdb_id && (
          <ExternalLink href={`https://www.thetvdb.com/?id=${externalIds.tvdb_id}`} label="TVDB" />
        )}
        {externalIds.wikidata_id && (
          <ExternalLink href={`https://www.wikidata.org/wiki/${externalIds.wikidata_id}`} label="Wikidata" />
        )}
        {externalIds.facebook_id && (
          <ExternalLink href={`https://www.facebook.com/${externalIds.facebook_id}`} label="Facebook" />
        )}
        {externalIds.instagram_id && (
          <ExternalLink href={`https://www.instagram.com/${externalIds.instagram_id}`} label="Instagram" />
        )}
        {externalIds.twitter_id && (
          <ExternalLink href={`https://twitter.com/${externalIds.twitter_id}`} label="Twitter / X" />
        )}
      </div>
    </div>
  );
}
