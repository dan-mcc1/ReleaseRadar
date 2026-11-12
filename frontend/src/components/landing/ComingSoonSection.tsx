import { Link } from "react-router-dom";
import type { Movie } from "../../types/calendar";
import { useComingSoonMonth } from "./useComingSoonMonth";
import { parseLocalDate } from "../../utils/date";
import { ChevronRightIcon, PosterCard, Rating, SectionHeader, moreLinkClass } from "../ui";
import PosterRail from "./PosterRail";

const releaseFormatter = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export default function ComingSoonSection() {
  const { movies, loading, rangeLabel } = useComingSoonMonth();

  return (
    <section aria-labelledby="landing-coming-soon">
      <SectionHeader
        id="landing-coming-soon"
        title="Coming soon"
        note={<span className="hidden sm:inline">{rangeLabel}</span>}
        className="mb-4"
        action={
          <Link to="/upcoming" className={moreLinkClass}>
            See all
            <ChevronRightIcon className="w-3.5 h-3.5" />
          </Link>
        }
      />
      <PosterRail label="upcoming movies" loading={loading}>
        {movies.map((item: Movie) => (
          <PosterCard
            key={item.id}
            to={`/movie/${item.id}`}
            title={item.title}
            posterPath={item.poster_path}
            subtitle={
              <span className="inline-flex items-center gap-1.5">
                {item.release_date && (
                  <time dateTime={item.release_date}>
                    {releaseFormatter.format(parseLocalDate(item.release_date))}
                  </time>
                )}
                <Rating value={item.vote_average} />
              </span>
            }
          />
        ))}
      </PosterRail>
    </section>
  );
}
