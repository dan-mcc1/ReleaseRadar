/**
 * Parse a "YYYY-MM-DD" date string as a local date (not UTC).
 * Using new Date("YYYY-MM-DD") treats it as UTC midnight, which shifts
 * the date back one day in timezones behind UTC (e.g. EST).
 */
export function parseLocalDate(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format a Date as a "YYYY-MM-DD" string using LOCAL time components.
 * date.toISOString() converts to UTC first, which shifts the date in
 * any UTC+ timezone (e.g. midnight local = yesterday UTC).
 */
export function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function formatLocalDate(dateStr: string, options: Intl.DateTimeFormatOptions): string {
  return parseLocalDate(dateStr).toLocaleDateString("en-us", options);
}
