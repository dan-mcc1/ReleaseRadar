import type { ReactNode } from "react";
import { CalendarIcon, RefreshIcon, SectionHeader, UsersIcon } from "../ui";

interface Point {
  icon: ReactNode;
  title: string;
  body: string;
}

// The positioning in PRODUCT.md: the three together are the claim, so they
// sit side by side rather than as a feature list.
const POINTS: Point[] = [
  {
    icon: <CalendarIcon className="w-5 h-5" />,
    title: "Never miss a release",
    body:
      "Your calendar and alerts come from the shows and movies you follow, not a general release feed. New episodes, season premieres, trailers and streaming arrivals reach you once, when they happen.",
  },
  {
    icon: <RefreshIcon className="w-5 h-5" />,
    title: "Lists that keep themselves",
    body:
      "Mark the last episode and a show moves to Watched. When a new season appears, it comes back to your Watchlist. Progress is kept per episode, with nothing to tidy up.",
  },
  {
    icon: <UsersIcon className="w-5 h-5" />,
    title: "Movies, TV and friends in one place",
    body:
      "Films and series side by side, plus what your friends are watching and recommending. No more one app for movies and another for TV.",
  },
];

export default function WhySection() {
  return (
    <section aria-labelledby="landing-why" className="max-w-7xl">
      <SectionHeader id="landing-why" title="Built around what you track" className="mb-6" />
      <ul className="grid gap-8 md:grid-cols-3">
        {POINTS.map((p) => (
          <li key={p.title} className="flex flex-col gap-3">
            <span className="inline-flex size-control items-center justify-center rounded-control border border-neutral-800 bg-neutral-900 text-primary-400">
              {p.icon}
            </span>
            <h3 className="text-title font-semibold text-neutral-50">{p.title}</h3>
            <p className="text-body text-neutral-300 max-w-sm">{p.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
