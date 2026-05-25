import { Component, type ErrorInfo, type ReactNode } from "react";
import * as Sentry from "@sentry/react";

type Props = {
  children: ReactNode;
  fallback?: ReactNode;
  scope?: string;
};

type State = {
  hasError: boolean;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.withScope((scope) => {
      if (this.props.scope) scope.setTag("boundary", this.props.scope);
      scope.setExtra("componentStack", info.componentStack);
      Sentry.captureException(error);
    });
  }

  handleReset = () => {
    this.setState({ hasError: false });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 p-6 text-center">
        <h2 className="text-xl font-semibold">Something went wrong</h2>
        <p className="text-sm text-gray-500 max-w-md">
          This part of the app hit an error. The team has been notified. You can try
          again or reload the page.
        </p>
        <div className="flex gap-2">
          <button
            onClick={this.handleReset}
            className="rounded-md border px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            Try again
          </button>
          <button
            onClick={this.handleReload}
            className="rounded-md bg-black px-3 py-1.5 text-sm text-white hover:bg-gray-800"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
