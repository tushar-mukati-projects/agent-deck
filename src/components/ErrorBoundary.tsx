import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[deck] render error", error, info.componentStack);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback(error, this.reset);
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-[13px] font-medium text-fg">Something went wrong in this view</p>
        <p className="max-w-[520px] font-mono text-[11px] break-words text-faint select-text">
          {error.message}
        </p>
        <button
          type="button"
          onClick={this.reset}
          className="h-7 rounded-md border border-border-strong bg-elevated px-3 text-xs text-fg hover:bg-hover"
        >
          Try again
        </button>
      </div>
    );
  }
}
