import { Component, type ReactNode } from "react";

import { Button } from "@/components/ui/button";

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
        <Button size="sm" className="px-3" onClick={this.reset}>
          Try again
        </Button>
      </div>
    );
  }
}

type CrashScreenProps = {
  error: Error;
};

export const CrashScreen = ({ error }: CrashScreenProps) => (
  <div className="flex h-full flex-col items-center justify-center gap-3 bg-bg p-8 text-center">
    <p className="text-[14px] font-medium text-fg">Something went wrong</p>
    <p className="max-w-[560px] font-mono text-[11px] break-words text-faint select-text">
      {error.message}
    </p>
    <p className="max-w-[480px] text-[12px] text-muted">
      Your sessions keep running in the background. Reloading reconnects to them.
    </p>
    <Button variant="primary" className="px-4 text-xs" onClick={() => location.reload()}>
      Reload
    </Button>
  </div>
);
