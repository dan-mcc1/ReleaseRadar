import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportError } from "../sentry";
import { Button, EmptyState } from "./ui";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  scope?: string;
};

type State = {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
  retryCount: number;
};

// One silent retry is enough to absorb most transient first-render races
// (query data arriving a tick late, auth state still settling). If the same
// error throws again on the retry, we treat it as real and show the fallback.
const MAX_SILENT_RETRIES = 1;
const RETRY_DELAY_MS = 200;

// Vite throws these when a code-split chunk can't be fetched, OR when the
// CDN serves index.html (HTML mime) where a chunk used to live — both happen
// after a deploy when the manifest moved. Reloading picks up the new
// manifest. Match on common substrings across browsers.
function isChunkLoadError(error: Error): boolean {
  const msg = `${error.name} ${error.message}`.toLowerCase();
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk") ||
    msg.includes("chunkloaderror") ||
    // MIME-type mismatch: SPA fallback served index.html where a .js chunk
    // was expected. Chrome / Firefox / Safari all phrase this slightly
    // differently, so match the common fragments.
    msg.includes("is not a valid javascript mime type") ||
    msg.includes("expected a javascript module script") ||
    msg.includes('mime type of "text/html"') ||
    msg.includes("mime type ('text/html')")
  );
}

// Guard against infinite reload loops: if reload already happened this
// session and we still see the same chunk error, the chunk is genuinely
// missing — show the boundary instead of cycling forever.
const CHUNK_RELOAD_KEY = "rr.chunkReloadAttempted";

function tryReloadOnce(): boolean {
  try {
    if (sessionStorage.getItem(CHUNK_RELOAD_KEY)) return false;
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
  } catch {
    // sessionStorage unavailable (private mode, etc.) — fall back to reloading
    // without a guard; better than not recovering at all.
  }
  window.location.reload();
  return true;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    error: null,
    componentStack: null,
    retryCount: 0,
  };

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ componentStack: info.componentStack ?? null });

    // Chunk-load errors mean the build moved out from under us — full reload
    // pulls the new manifest. Skip Sentry noise unless the reload itself
    // didn't fix it (chunk genuinely missing), in which case let the boundary
    // surface normally so the user isn't stuck in a reload loop.
    if (isChunkLoadError(error)) {
      if (tryReloadOnce()) return;
      // Already reloaded this session and still failing — report it for real.
      reportError(error, {
        ...(this.props.scope ? { boundary: this.props.scope } : {}),
        chunkReloadFailed: "true",
      });
      return;
    }

    // Silent first retry — most "fine on reload" boundary hits are transient.
    // Don't ship the error to Sentry until the retry also fails, so the
    // dashboard isn't drowning in noise that nobody ever saw.
    if (this.state.retryCount < MAX_SILENT_RETRIES) {
      this.retryTimer = setTimeout(() => {
        this.setState((s) => ({
          hasError: false,
          error: null,
          componentStack: null,
          retryCount: s.retryCount + 1,
        }));
      }, RETRY_DELAY_MS);
      return;
    }

    reportError(
      error,
      this.props.scope ? { boundary: this.props.scope } : {},
      { componentStack: info.componentStack, retryCount: this.state.retryCount },
    );
  }

  componentWillUnmount() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      componentStack: null,
      retryCount: 0,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const isDev = import.meta.env.DEV;
    const { error, componentStack } = this.state;

    return (
      <div className="mx-auto max-w-3xl px-4 py-6">
        <div>
          <EmptyState
            className="py-10"
            title="This section couldn't load"
            description="The rest of the page is still usable. Try again, or reload if it keeps happening."
            action={
              <>
                <Button onClick={this.handleReset}>Try again</Button>
                <Button variant="primary" onClick={this.handleReload}>
                  Reload page
                </Button>
              </>
            }
          />
          <div className="min-w-0 flex-1">
            {isDev && error && (
              <details
                open
                className="mt-3 rounded-control border border-error-500/40 bg-error-500/5 p-3 text-caption"
              >
                <summary className="cursor-pointer text-error-400 font-semibold">
                  {error.name}: {error.message}
                </summary>
                {error.stack && (
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap text-error-300/80">
                    {error.stack}
                  </pre>
                )}
                {componentStack && (
                  <pre className="mt-2 overflow-auto whitespace-pre-wrap text-neutral-400">
                    {componentStack}
                  </pre>
                )}
              </details>
            )}
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
