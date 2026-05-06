// frontend/src/components/media/RatingsRow.tsx
import { RatingBadge } from "../InfoPageWidgets";
import type { ExternalScores, AggregateRating } from "../../types/media";

interface Props {
  voteAverage?: number | null;
  externalScores: ExternalScores | null;
  aggRating: AggregateRating | null;
}

export default function RatingsRow({ voteAverage, externalScores, aggRating }: Props) {
  if (!voteAverage && !externalScores && !aggRating?.average) return null;

  return (
    <div>
      <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-3">Ratings</h2>
      <div className="flex flex-wrap gap-3">
        {voteAverage != null && voteAverage > 0 && (
          <RatingBadge label="TMDb" value={`${voteAverage.toFixed(1)}/10`} color="border-2 border-primary-800" />
        )}
        {externalScores?.imdb && (
          <RatingBadge
            label="IMDB"
            value={externalScores.imdb}
            color={parseFloat(externalScores.imdb) >= 6.0 ? "border-2 border-success-800" : "border-2 border-error-800"}
          />
        )}
        {externalScores?.rotten_tomatoes && (
          <RatingBadge
            label="Rotten Tomatoes"
            value={externalScores.rotten_tomatoes}
            color={parseInt(externalScores.rotten_tomatoes) >= 60 ? "border-2 border-success-800" : "border-2 border-error-800"}
          />
        )}
        {externalScores?.metacritic && (
          <RatingBadge
            label="Metacritic"
            value={externalScores.metacritic.replace("/100", "")}
            color="border-2 border-warning-800/50"
          />
        )}
        {aggRating?.average && (
          <RatingBadge
            label={`Users (${aggRating.count})`}
            value={`${aggRating.average}/5 ★`}
            color="border-2 border-highlight-800"
          />
        )}
      </div>
    </div>
  );
}
