export function RatingBadge({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div
      className={`flex flex-col items-center bg-neutral-800 border rounded-xl px-4 py-3 min-w-[80px] ${color}`}
    >
      <span className="text-neutral-100 font-bold text-lg leading-tight">
        {value}
      </span>
      <span className="text-neutral-500 text-xs mt-0.5 whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

export function StatBox({
  label,
  value,
}: {
  label: string;
  value: string | number | null | undefined;
}) {
  if (!value && value !== 0) return null;
  return (
    <div className="flex flex-col items-center bg-neutral-800 border border-neutral-700 rounded-xl px-4 py-3 min-w-[80px]">
      <span className="text-neutral-100 font-bold text-lg leading-tight">
        {value}
      </span>
      <span className="text-neutral-500 text-xs mt-0.5 whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

export function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-sm text-neutral-400 hover:text-primary-400 bg-neutral-800 border border-neutral-700 hover:border-primary-600/50 px-3 py-1.5 rounded-lg transition-all duration-150"
    >
      {label}
    </a>
  );
}
