import { RotateCw, TriangleAlert } from 'lucide-react';
import { Component, type ReactNode } from 'react';
import { Button } from './ui/Button';
import { Card } from './ui/Card';

interface ErrorBoundaryState {
  error: Error | null;
}

/** Catches render errors anywhere below it, so a bug shows a way to recover rather than a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <Card className="max-w-md p-8 text-center">
          <div className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-rose-500/10 ring-1 ring-rose-400/20">
            <TriangleAlert aria-hidden="true" className="size-6 text-rose-300" />
          </div>
          <h1 className="text-lg font-semibold">Something went wrong</h1>
          <p className="mt-2 text-sm text-zinc-400">{error.message}</p>
          <Button className="mt-6" onClick={() => window.location.reload()}>
            <RotateCw aria-hidden="true" className="size-4" />
            Reload
          </Button>
        </Card>
      </main>
    );
  }
}
