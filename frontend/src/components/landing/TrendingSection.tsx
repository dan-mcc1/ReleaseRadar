import { useState } from "react";
import { Link } from "react-router-dom";
import type { Movie, Show } from "../../types/calendar";
import { useTrendingMulti } from "../../hooks/api/useSearch";
import { ChevronRightIcon, PosterCard, Rating, SectionHeader, Segmented, moreLinkClass } from "../ui";
import PosterRail from "./PosterRail";

type AnyItem = Movie | Show;
type TypedItem = AnyItem & { _type: "movie" | "tv" };
type ContentFilter = "all" | "movie" | "tv";

function getTitle(item: AnyItem) {
  return "title" in item ? item.title : item.name;
}

export default function TrendingSection() {
  const { data, isPending: loading } = useTrendingMulti();
  const [filter, setFilter] = useState<ContentFilter>("all");

  const movies = data?.movies ?? [];
  const shows = data?.shows ?? [];

  // Movies and shows alternate, so "All" isn't a wall of one kind.
  const items: TypedItem[] = [];
  for (let i = 0; i < Math.max(movies.length, shows.length); i++) {
    if (movies[i]) items.push({ ...movies[i], _type: "movie" });
    if (shows[i]) items.push({ ...shows[i], _type: "tv" });
  }
  const filtered = filter === "all" ? items : items.filter((i) => i._type === filter);

  return (
    <section aria-labelledby="landing-trending">
      <SectionHeader
        id="landing-trending"
        title="Trending this week"
        className="mb-4"
        action={
          <div className="flex items-center gap-4">
            <Segmented
              label="Show"
              value={filter}
              onChange={setFilter}
              options={[
                { value: "all", label: "All" },
                { value: "movie", label: "Movies" },
                { value: "tv", label: "TV" },
              ]}
            />
            <Link to="/trending" className={moreLinkClass}>
              See all
              <ChevronRightIcon className="w-3.5 h-3.5" />
            </Link>
          </div>
        }
      />
      <PosterRail label="trending titles" loading={loading} contentKey={filter}>
        {filtered.map((item) => (
          <PosterCard
            key={`${item._type}-${item.id}`}
            to={`/${item._type}/${item.id}`}
            title={getTitle(item)}
            posterPath={item.poster_path}
            subtitle={
              <span className="inline-flex items-center gap-1.5">
                {item.genres?.[0]?.name && <span>{item.genres[0].name}</span>}
                <Rating value={item.vote_average} />
              </span>
            }
          />
        ))}
      </PosterRail>
    </section>
  );
}
