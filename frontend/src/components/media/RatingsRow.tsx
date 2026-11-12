// frontend/src/components/media/RatingsRow.tsx
import { RatingBadge } from "../InfoPageWidgets";
import { SectionHeader } from "../ui";
import type { ExternalScores, AggregateRating } from "../../types/media";

interface Props {
  voteAverage?: number | null;
  externalScores: ExternalScores | null;
  aggRating: AggregateRating | null;
  hideTitle?: boolean;
}

export default function RatingsRow({
  voteAverage,
  externalScores,
  aggRating,
  hideTitle = false,
}: Props) {
  if (!voteAverage && !externalScores && !aggRating?.average) return null;

  return (
    <div>
      {!hideTitle && <SectionHeader title="Ratings" className="mb-3" />}
      <div className="flex flex-wrap gap-3">
        {voteAverage != null && voteAverage > 0 && (
          <RatingBadge label="TMDb" value={`${voteAverage.toFixed(1)}/10`} />
        )}
        {externalScores?.imdb && (
          <RatingBadge label="IMDB" value={externalScores.imdb} />
        )}
        {externalScores?.rotten_tomatoes && (
          <RatingBadge
            label="Rotten Tomatoes"
            value={externalScores.rotten_tomatoes}
          />
        )}
        {externalScores?.metacritic && (
          <RatingBadge
            label="Metacritic"
            value={externalScores.metacritic.replace("/100", "")}
          />
        )}
        {aggRating?.average && (
          <RatingBadge
            label={`Users (${aggRating.count})`}
            value={`${aggRating.average}/5`}
          />
        )}
      </div>
    </div>
  );
}
