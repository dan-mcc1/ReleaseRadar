/**
 * Sentry loads in its own chunk right after startup instead of sitting in
 * the main bundle (with session replay it was about a quarter of it).
 * Errors reported before it finishes loading are sent once it's ready.
 */
type SentryModule = typeof import("@sentry/react");

let sentry: Promise<SentryModule> | null = null;

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || sentry) return;
  sentry = import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      tracesSampleRate: 0.1,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 1.0,
      integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    });
    return Sentry;
  });
}

export function reportError(
  error: unknown,
  tags: Record<string, string> = {},
  extras: Record<string, unknown> = {},
): void {
  void sentry?.then((Sentry) =>
    Sentry.withScope((scope) => {
      scope.setTags(tags);
      scope.setExtras(extras);
      Sentry.captureException(error);
    }),
  );
}
