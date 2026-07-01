"use client";

import * as React from "react";
import { DesktopApp } from "./desktop-app";

class DesktopErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.error("[desktop] render failed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <div className="max-w-md space-y-3 text-center">
            <h1 className="text-lg font-semibold">Apical failed to load</h1>
            <p className="text-sm text-muted-foreground">
              The desktop UI crashed in the WebView. Try quitting and reopening the app.
            </p>
            <pre className="overflow-auto rounded-md border border-border bg-muted/40 p-3 text-left text-xs">
              {this.state.error.message}
            </pre>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** Client wrapper so AuthProvider context is available after server auth check. */
export function DesktopAppClient({ user }: { user: { email: string; name: string } }) {
  return (
    <DesktopErrorBoundary>
      <DesktopApp user={user} />
    </DesktopErrorBoundary>
  );
}
