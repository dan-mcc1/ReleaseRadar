export function RatingBadge({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col items-center bg-neutral-800 border border-neutral-700 rounded-control px-4 py-3 min-w-[80px]">
      <span className="text-neutral-100 font-semibold text-title leading-tight tabular">
        {value}
      </span>
      <span className="text-neutral-400 text-caption mt-0.5 whitespace-nowrap">
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
    <div className="flex flex-col items-center bg-neutral-800 border border-neutral-700 rounded-control px-4 py-3 min-w-[80px]">
      <span className="text-neutral-100 font-semibold text-title leading-tight tabular">
        {value}
      </span>
      <span className="text-neutral-400 text-caption mt-0.5 whitespace-nowrap">
        {label}
      </span>
    </div>
  );
}

import { safeHref } from "../utils/safeHref";

export function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={safeHref(href)}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 text-label text-neutral-300 hover:text-primary-300 border border-neutral-700 hover:border-neutral-500 px-3 py-1.5 rounded-control transition-colors"
    >
      {label}
    </a>
  );
}
