import { useComingSoon } from "../../hooks/api/useSearch";
import { toLocalISODate } from "../../utils/date";

const rangeFormatter = new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" });

/**
 * Movies releasing between today and a month from now. The landing page's
 * release preview and its Coming soon rail share this one request.
 */
export function useComingSoonMonth() {
  const today = new Date();
  const monthOut = new Date(today);
  monthOut.setMonth(monthOut.getMonth() + 1);
  const { data, isPending } = useComingSoon(toLocalISODate(today), toLocalISODate(monthOut));
  return {
    movies: data ?? [],
    loading: isPending,
    rangeLabel: `${rangeFormatter.format(today)} – ${rangeFormatter.format(monthOut)}`,
  };
}
