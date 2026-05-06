// frontend/src/components/media/TrailerButton.tsx

interface Props {
  trailerKey: string;
}

export default function TrailerButton({ trailerKey }: Props) {
  return (
    <a
      href={`https://www.youtube.com/watch?v=${trailerKey}`}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-error-600 hover:bg-error-500 text-white text-sm font-semibold transition-colors"
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
        <path d="M8 5v14l11-7z" />
      </svg>
      Trailer
    </a>
  );
}
