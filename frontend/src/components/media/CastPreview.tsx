// frontend/src/components/media/CastPreview.tsx
import { Button, PosterCard, SectionHeader } from "../ui";

interface CastMember {
  id: number;
  name: string;
  profile_path: string | null;
  character: string;
}

interface Props {
  cast: CastMember[];
  /** Opens the full cast list. */
  onSeeAll: () => void;
  /** How many people to show; 8 suits a full-width row, 6 a narrower one. */
  count?: 6 | 8;
}

/** The first few cast members on the Overview tab, with a link to the rest. */
export default function CastPreview({ cast, onSeeAll, count = 6 }: Props) {
  if (!cast?.length) return null;

  return (
    <div className="@container">
      <SectionHeader
        title="Cast"
        divider
        className="mb-4"
        action={
          cast.length > count && (
            <Button variant="ghost" size="sm" onClick={onSeeAll}>
              See all {cast.length}
            </Button>
          )
        }
      />
      <div
        className={`grid gap-x-2 gap-y-4 ${
          count === 8 ? "grid-cols-4 @3xl:grid-cols-8" : "grid-cols-3 @xl:grid-cols-6"
        }`}
      >
        {cast.slice(0, count).map((actor) => (
          <PosterCard
            key={actor.id}
            to={`/person/${actor.id}`}
            title={actor.name}
            posterPath={actor.profile_path}
            posterSize="w185"
            subtitle={actor.character}
          />
        ))}
      </div>
    </div>
  );
}
