import {
  householdErrorMessage,
  useAddHouseholdItem,
  useHouseholdRecommendations,
  type HouseholdPick,
} from "../hooks/api/useHouseholds";
import { useToast } from "./Toast";
import { IconButton, PlusIcon, PosterCard, SectionHeader } from "./ui";
import { pickReason } from "../utils/households";

const SHOWN = 16;

/** Shows and movies interleaved, so the rail isn't all one kind. */
function interleave(shows: HouseholdPick[], movies: HouseholdPick[]): HouseholdPick[] {
  const out: HouseholdPick[] = [];
  for (let i = 0; i < Math.max(shows.length, movies.length); i++) {
    if (shows[i]) out.push(shows[i]);
    if (movies[i]) out.push(movies[i]);
  }
  return out;
}

/**
 * Recommendations for the household, from what its members share. Each pick
 * says why, and + puts it on the Watch together list.
 */
export default function HouseholdPicks({ householdId, memberCount }: { householdId: number; memberCount: number }) {
  const { data, isPending, isError } = useHouseholdRecommendations(householdId);
  const add = useAddHouseholdItem();
  const toast = useToast();

  if (isPending || isError || !data) return null; // the list below still works
  const picks = interleave(data.shows, data.movies).slice(0, SHOWN);
  if (picks.length === 0) return null;

  return (
    <section aria-labelledby="household-picks" className="mb-10">
      <SectionHeader
        id="household-picks"
        title="Picks for you"
        note={
          data.shared_count > 0
            ? "from what you've watched and saved together"
            : "from what each of you watches; watch or save things together to sharpen these"
        }
        className="mb-3"
      />
      <div className="grid grid-flow-col auto-cols-[8rem] sm:auto-cols-[9rem] gap-4 overflow-x-auto pb-2 -mx-1 px-1">
        {picks.map((p) => {
          const title = (p.media_type === "tv" ? p.name : p.title) ?? "";
          return (
            <PosterCard
              key={`${p.media_type}-${p.id}`}
              to={`/${p.media_type}/${p.id}`}
              title={title}
              posterPath={p.poster_path}
              posterSize="w185"
              subtitle={pickReason(p, memberCount) ?? (p.media_type === "tv" ? "Series" : "Movie")}
              actions={
                <IconButton
                  label={`Add ${title} to the Watch together list`}
                  icon={<PlusIcon />}
                  variant="overlay"
                  size="touch"
                  disabled={add.isPending}
                  onClick={() =>
                    add.mutate(
                      { householdId, contentType: p.media_type, contentId: p.id },
                      {
                        onSuccess: () => toast.success(`Added ${title} to your list`),
                        onError: (err) => toast.error(householdErrorMessage(err)),
                      },
                    )
                  }
                />
              }
            />
          );
        })}
      </div>
    </section>
  );
}
