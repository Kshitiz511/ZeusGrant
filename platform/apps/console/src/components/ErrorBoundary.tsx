import React from "react";

type Props = { children: React.ReactNode };
type State = { error: Error | null };

/**
 * Last line of defence between a render error and a blank page.
 *
 * Without this, any exception thrown while rendering unmounts the whole tree
 * and leaves an empty white document: no message, no failed request, nothing
 * in the network tab to point at. That is the hardest possible thing to
 * report and the hardest to diagnose, because the symptom is indistinguishable
 * from a deploy that served nothing at all.
 *
 * A stale build is treated as its own case. Assets are content-hashed, so a
 * page left open across a deploy can reference a bundle that no longer
 * exists; reloading genuinely fixes it, and telling someone to reload is more
 * use than showing them a stack trace they cannot act on.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Kept as console output rather than sent anywhere: there is no error
    // pipeline yet, and inventing one silently would be worse than being
    // honest that this is local-only for now.
    console.error("Console crashed while rendering", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-foreground">
            Something went wrong on this page
          </h1>
          <p className="text-sm text-muted-foreground">
            The error has been logged to the browser console. Reloading usually
            clears it, especially just after an update.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex h-10 w-full items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
          >
            Reload the page
          </button>
          <p className="break-words text-left font-mono text-xs text-muted-foreground">
            {error.message}
          </p>
        </div>
      </div>
    );
  }
}
