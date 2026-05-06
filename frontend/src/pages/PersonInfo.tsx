import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { BASE_IMAGE_URL } from "../constants";
import type { Movie, Show } from "../types/calendar";
import { formatLocalDate } from "../utils/date";
import { usePageTitle } from "../hooks/usePageTitle";
import { usePersonInfo } from "../hooks/api/usePersonInfo";

type FullPersonData = {
  id: number;
  name: string;
  profile_path: string | null;
  biography: string;
  birthday: string | null;
  deathday: string | null;
  place_of_birth: string | null;
  known_for_department: string;
  external_ids: {
    imdb_id: string | null;
    facebook_id: string | null;
    instagram_id: string | null;
    twitter_id: string | null;
    wikidata_id: string | null;
  };
  movie_credits: { cast: Movie[]; crew: Movie[] };
  tv_credits: { cast: Show[]; crew: Show[] };
};

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center text-sm text-neutral-400 hover:text-primary-400 bg-neutral-800 border border-neutral-700 hover:border-primary-600/50 px-3 py-1.5 rounded-lg transition-all duration-150"
    >
      {label}
    </a>
  );
}

function CreditList({
  title,
  credits,
  linkPrefix,
  limit = 12,
}: {
  title: string;
  credits: (Movie | Show)[];
  linkPrefix: string;
  limit?: number;
}) {
  const [showAll, setShowAll] = useState(false);
  if (!credits || credits.length === 0) return null;
  const displayed = showAll ? credits : credits.slice(0, limit);

  return (
    <div>
      <h2 className="text-xl font-semibold text-neutral-100 mb-4">{title}</h2>
      <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3">
        {displayed.map((item) => {
          const name = "title" in item ? item.title : item.name;
          const poster = item.poster_path || item.backdrop_path;
          const role = (item as any).character;

          return (
            <Link
              key={item.id}
              to={`${linkPrefix}/${item.id}`}
              className="group"
            >
              {poster ? (
                <img
                  src={`${BASE_IMAGE_URL}/w342${poster}`}
                  alt={name}
                  className="w-full rounded-lg object-cover border border-neutral-700 group-hover:border-neutral-500 transition-all duration-200 group-hover:scale-105"
                />
              ) : (
                <div className="w-full aspect-[2/3] bg-neutral-800 border border-neutral-700 rounded-lg flex items-center justify-center">
                  <span className="text-neutral-500 text-xs text-center px-1">
                    {name}
                  </span>
                </div>
              )}
              <p className="text-xs mt-1.5 text-center text-neutral-400 group-hover:text-neutral-200 transition-colors line-clamp-1">
                {name}
              </p>
              {role && (
                <p className="text-xs text-center text-neutral-600 truncate">
                  {role}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      {credits.length > limit && (
        <button
          onClick={() => setShowAll(!showAll)}
          className="mt-4 text-sm text-primary-400 hover:text-primary-300 hover:underline"
        >
          {showAll ? "Show Less" : `Show ${credits.length - limit} more`}
        </button>
      )}
    </div>
  );
}

export default function PersonInfo() {
  const { id } = useParams<{ id: string }>();
  const { data: person, isPending: loading, error } = usePersonInfo<FullPersonData>(id);
  usePageTitle(person?.name);
  const [bioExpanded, setBioExpanded] = useState(false);

  if (loading)
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-neutral-400 text-sm">Loading…</p>
        </div>
      </div>
    );
  if (error) return <p className="text-error-400 p-6">{error?.message}</p>;
  if (!person) return <p className="text-neutral-400 p-6">Person not found.</p>;

  const BIO_TRUNCATE = 400;
  const bioIsTruncatable =
    person.biography && person.biography.length > BIO_TRUNCATE;
  const displayedBio =
    bioIsTruncatable && !bioExpanded
      ? person.biography.slice(0, BIO_TRUNCATE) + "…"
      : person.biography;

  return (
    <div className="w-full max-w-5xl mx-auto px-4 sm:px-6 py-8 pb-16 space-y-10">
      {/* ── PROFILE SECTION ── */}
      <div className="flex flex-col sm:flex-row gap-6">
        {/* Photo */}
        {person.profile_path && (
          <div className="flex-shrink-0">
            <img
              src={`${BASE_IMAGE_URL}/w500${person.profile_path}`}
              alt={person.name}
              className="w-40 sm:w-48 rounded-2xl object-cover border border-neutral-700 shadow-2xl shadow-black/50"
            />
          </div>
        )}

        {/* Info */}
        <div className="flex-1 space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-white">{person.name}</h1>
            {person.known_for_department && (
              <p className="text-neutral-400 mt-1">
                {person.known_for_department}
              </p>
            )}
          </div>

          {/* Bio facts */}
          <div className="grid grid-cols-2 gap-3 text-sm">
            {person.birthday && (
              <div className="bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3">
                <div className="text-neutral-500 text-xs uppercase tracking-wide mb-0.5">
                  Born
                </div>
                <div className="text-neutral-200">
                  {formatLocalDate(person.birthday, {
                    year: "numeric",
                    month: "long",
                    day: "numeric",
                  })}
                </div>
              </div>
            )}
            {person.deathday && (
              <div className="bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3">
                <div className="text-neutral-500 text-xs uppercase tracking-wide mb-0.5">
                  Died
                </div>
                <div className="text-neutral-200">{person.deathday}</div>
              </div>
            )}
            {person.place_of_birth && (
              <div className="bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 col-span-2">
                <div className="text-neutral-500 text-xs uppercase tracking-wide mb-0.5">
                  Place of Birth
                </div>
                <div className="text-neutral-200">{person.place_of_birth}</div>
              </div>
            )}
          </div>

          {/* External links */}
          {person.external_ids && (
            <div className="flex flex-wrap gap-2">
              {person.external_ids.imdb_id && (
                <ExternalLink
                  href={`https://www.imdb.com/name/${person.external_ids.imdb_id}`}
                  label="IMDb"
                />
              )}
              {person.external_ids.instagram_id && (
                <ExternalLink
                  href={`https://www.instagram.com/${person.external_ids.instagram_id}`}
                  label="Instagram"
                />
              )}
              {person.external_ids.twitter_id && (
                <ExternalLink
                  href={`https://twitter.com/${person.external_ids.twitter_id}`}
                  label="Twitter / X"
                />
              )}
              {person.external_ids.facebook_id && (
                <ExternalLink
                  href={`https://www.facebook.com/${person.external_ids.facebook_id}`}
                  label="Facebook"
                />
              )}
              {person.external_ids.wikidata_id && (
                <ExternalLink
                  href={`https://www.wikidata.org/wiki/${person.external_ids.wikidata_id}`}
                  label="Wikidata"
                />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Biography */}
      {person.biography && (
        <div>
          <h2 className="text-neutral-400 text-xs uppercase tracking-wider font-semibold mb-3">
            Biography
          </h2>
          <p className="text-neutral-300 leading-relaxed">{displayedBio}</p>
          {bioIsTruncatable && (
            <button
              onClick={() => setBioExpanded(!bioExpanded)}
              className="mt-2 text-sm text-primary-400 hover:text-primary-300 hover:underline"
            >
              {bioExpanded ? "Show less" : "Read more"}
            </button>
          )}
        </div>
      )}

      {/* Credits */}
      <CreditList
        title="Movies"
        credits={person.movie_credits.cast}
        linkPrefix="/movie"
      />
      <CreditList
        title="TV Shows"
        credits={person.tv_credits.cast}
        linkPrefix="/tv"
      />
    </div>
  );
}
