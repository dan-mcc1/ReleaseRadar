import { Link } from "react-router-dom";
import { useServicesOverview } from "../../hooks/api/useStreamingServices";
import { daysUntil, whenLabel } from "../../utils/services";
import { cx, focusRing } from "../ui";

/**
 * One line in the calendar rail when a service needs a look: a paused one
 * with a premiere from the user's list within two weeks, or ones with nothing
 * coming. Renders nothing otherwise, or while loading.
 */
export default function ServicesHint({ className }: { className?: string }) {
  const { data } = useServicesOverview();
  if (!data) return null;

  const resumeSoon = data.services.find(
    (s) => s.verdict === "paused" && s.next_premiere && daysUntil(s.next_premiere.date) <= 14,
  );
  const pausable = data.services.filter((s) => s.verdict === "pause");

  let message: string | null = null;
  if (resumeSoon?.next_premiere) {
    const when = whenLabel(resumeSoon.next_premiere.date);
    message = `${resumeSoon.next_premiere.title} lands on ${resumeSoon.name} ${
      /^(Today|Tomorrow|In )/.test(when) ? when.toLowerCase() : `on ${when}`
    }, and you've marked it as paused.`;
  } else if (pausable.length === 1) {
    message = `Nothing from your list is coming to ${pausable[0].name} for a while. You could pause it.`;
  } else if (pausable.length > 1) {
    message = `${pausable.length} of your services have nothing coming from your list for a while.`;
  }
  if (!message) return null;

  return (
    <section
      className={cx("bg-neutral-900 border border-neutral-800 rounded-surface p-4", className)}
      aria-labelledby="calendar-services-hint"
    >
      <h2 id="calendar-services-hint" className="text-label font-semibold text-neutral-200">
        Your services
      </h2>
      <p className="mt-1 text-label text-neutral-400">{message}</p>
      <Link
        to="/services"
        className={cx(
          "mt-2 inline-block rounded-sm text-label font-medium text-primary-400 hover:text-primary-300 transition-colors",
          focusRing,
        )}
      >
        Review My services
      </Link>
    </section>
  );
}
