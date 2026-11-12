import { PosterCard, SectionHeader } from "./ui";

interface CastBarProps {
  cast: Cast[];
}

type Cast = {
  id: number;
  name: string;
  profile_path: string | null;
  character: string;
};

export default function CastBar({ cast }: CastBarProps) {
  if (!cast?.length) return null;

  return (
    <div>
      <SectionHeader title="Cast" className="mb-4" />
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-7 lg:grid-cols-9 xl:grid-cols-10 gap-x-2 gap-y-4">
        {cast.map((actor) => (
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
