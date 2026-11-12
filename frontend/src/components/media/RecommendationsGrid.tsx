// frontend/src/components/media/RecommendationsGrid.tsx
import { PosterCard, SectionHeader } from "../ui";

interface RecommendationItem {
  id: number;
  poster_path?: string | null;
  title?: string;
  name?: string;
}

interface Props {
  items: RecommendationItem[];
  linkPrefix: "/movie" | "/tv";
}

export default function RecommendationsGrid({ items, linkPrefix }: Props) {
  if (!items.length) return null;
  return (
    <div>
      <SectionHeader title="You might also like" className="mb-4" />
      <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-x-2 gap-y-4">
        {items.slice(0, 20).map((rec) => (
          <PosterCard
            key={rec.id}
            to={`${linkPrefix}/${rec.id}`}
            title={rec.title ?? rec.name ?? ""}
            posterPath={rec.poster_path}
          />
        ))}
      </div>
    </div>
  );
}
