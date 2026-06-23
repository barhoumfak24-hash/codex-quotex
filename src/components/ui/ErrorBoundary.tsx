import { Component, type ErrorInfo, type ReactNode } from "react";
import { reportClientError } from "@/lib/errorTracking";

type ErrorBoundaryProps = {
  children: ReactNode;
  fallback?: ReactNode;
  compact?: boolean;
};

type ErrorBoundaryState = {
  error: Error | null;
};

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[quotex] Render failure contained by ErrorBoundary", error, info);
    reportClientError(error, {
      tags: { boundary: "react" },
      extra: { componentStack: info.componentStack },
    });
  }

  render() {
    if (!this.state.error) return this.props.children;

    if (this.props.fallback) return this.props.fallback;
    if (this.props.compact) return null;

    return (
      <section
        role="alert"
        aria-live="assertive"
        className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-950 shadow-soft"
      >
        <h2 className="font-display text-2xl">This section needs a refresh.</h2>
        <p className="mt-2 text-sm text-red-900">
          The rest of the portal is still available. Reload the page, or open another category
          from the sidebar while this section recovers.
        </p>
        <p className="mt-3 rounded-md bg-white/75 px-3 py-2 font-mono text-xs text-red-800">
          {this.state.error.message}
        </p>
      </section>
    );
  }
}
