// frontend/src/components/media/MediaHero.tsx
import { BASE_IMAGE_URL } from "../../constants";

interface Props {
  backdropPath: string | null | undefined;
  posterPath: string | null | undefined;
  logoPath: string | null | undefined;
  title: string;
  tagline?: string | null;
  minHeight?: string;
}

export default function MediaHero({ backdropPath, posterPath, logoPath, title, tagline, minHeight = "280px" }: Props) {
  return (
    <div className="relative overflow-hidden" style={{ minHeight }}>
      {backdropPath ? (
        <img
          src={`${BASE_IMAGE_URL}/original${backdropPath}`}
          alt=""
          className="w-full h-72 md:h-96 object-cover object-top"
        />
      ) : (
        <div className="w-full h-64 bg-gradient-to-br from-neutral-800 to-neutral-900" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-neutral-950/10" />
      <div className="absolute inset-0 bg-gradient-to-r from-neutral-950/60 to-transparent" />

      <div className="absolute bottom-0 left-0 right-0 px-6 pb-6 flex items-end gap-5">
        {posterPath && (
          <img
            src={`${BASE_IMAGE_URL}/w500${posterPath}`}
            alt={title}
            className="hidden md:block w-28 lg:w-36 rounded-xl shadow-2xl border border-white/10 flex-shrink-0 -mb-1"
          />
        )}
        <div className="min-w-0">
          {logoPath ? (
            <img
              src={`${BASE_IMAGE_URL}/w500${logoPath}`}
              alt={title}
              className="max-h-16 max-w-[280px] object-contain drop-shadow-2xl mb-1"
            />
          ) : (
            <h1 className="text-3xl md:text-4xl font-bold text-white drop-shadow-lg">{title}</h1>
          )}
          {tagline && <p className="text-neutral-300 italic text-sm mt-1">{tagline}</p>}
        </div>
      </div>
    </div>
  );
}
