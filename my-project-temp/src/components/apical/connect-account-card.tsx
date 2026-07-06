"use client";

import * as React from "react";
import { Plug, CheckCircle2, Loader2, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { openPipedreamConnect } from "@/lib/apical/pipedream-connect-client";
import type { ConnectionRequestState } from "@/lib/apical";

/**
 * An inline "Connect your <App> account" card rendered in the chat when an
 * agent calls `connection_request`. One click opens Pipedream's managed-auth
 * window (popup/iframe); the account is verified + materialized server-side,
 * and the agent auto-resumes once every requested connection is resolved.
 * The card persists with the message until connected or skipped.
 */
export function ConnectAccountCard({
  request,
  onResolved,
  stepLabel,
}: {
  request: ConnectionRequestState;
  onResolved?: (info: { app: string; action: "connected" | "dismissed"; credentialId?: string }) => void;
  /** e.g. "App 1 of 3" — shown when part of a sequential list. */
  stepLabel?: string;
}) {
  const [connecting, setConnecting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Covers "auth completed while the tab was closed": if a connection for
  // this app already exists on mount, resolve the card immediately.
  React.useEffect(() => {
    if (request.status && request.status !== "pending") return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch(`/api/pipedream/accounts?app=${encodeURIComponent(request.app)}`);
        if (!res.ok || cancelled) return;
        const body = (await res.json()) as {
          accounts?: Array<{ credentialId: string }>;
        };
        const existing = body.accounts?.[0];
        if (existing && !cancelled) {
          onResolved?.({ app: request.app, action: "connected", credentialId: existing.credentialId });
        }
      } catch {
        // Non-fatal — the user can still click Connect.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function connect() {
    setConnecting(true);
    setError(null);
    void openPipedreamConnect({
      app: request.app,
      onSuccess: (info) => {
        setConnecting(false);
        onResolved?.({ app: request.app, action: "connected", credentialId: info.credentialId });
      },
      onError: (message) => {
        setConnecting(false);
        setError(message);
      },
      onCancel: () => setConnecting(false),
    });
  }

  if (request.status === "dismissed") return null;

  if (request.status === "connected") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span className="text-foreground">
          Connected <span className="font-medium">{request.name}</span>.
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-muted p-3 text-xs">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-semibold text-foreground">
          {request.imgSrc ? (
            <img src={request.imgSrc} alt="" className="h-4 w-4 rounded-sm" />
          ) : (
            <Plug className="h-3.5 w-3.5 text-brand" />
          )}
          Connect your {request.name} account
          {stepLabel && (
            <span className="text-[10px] font-normal text-muted-foreground">· {stepLabel}</span>
          )}
        </div>
        <button
          type="button"
          aria-label="Skip this connection"
          className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
          onClick={() => onResolved?.({ app: request.app, action: "dismissed" })}
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      {request.reason && <p className="mb-2 text-muted-foreground">{request.reason}</p>}
      <p className="mb-2 text-[11px] text-muted-foreground">
        A secure window opens to authorize access — no API keys to copy, and your login stays with{" "}
        {request.name}.
      </p>
      {error && (
        <div className="mb-2 flex items-center gap-1.5 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-[11px] text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" /> {error}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" className="h-7 px-3 text-xs" disabled={connecting} onClick={connect}>
          {connecting ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Waiting for authorization…
            </>
          ) : (
            <>Connect {request.name}</>
          )}
        </Button>
        <button
          type="button"
          className="text-[11px] text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => onResolved?.({ app: request.app, action: "dismissed" })}
        >
          Skip
        </button>
      </div>
    </div>
  );
}

/**
 * Renders the turn's connection requests as a sequential checklist (one card
 * active at a time), mirroring CredentialRequestList's UX.
 */
export function ConnectAccountCardList({
  requests,
  onResolved,
}: {
  requests: ConnectionRequestState[];
  onResolved?: (info: { app: string; action: "connected" | "dismissed"; credentialId?: string }) => void;
}) {
  const pendingIndex = requests.findIndex((r) => !r.status || r.status === "pending");
  return (
    <div className="flex flex-col">
      {requests.map((r, i) => {
        const isActive = i === pendingIndex;
        const resolved = r.status === "connected" || r.status === "dismissed";
        if (!isActive && !resolved) {
          // Not yet reached in the stepper — show a muted placeholder row.
          return (
            <div
              key={r.app}
              className="mt-2 flex items-center gap-2 rounded-md border border-dashed border-border px-3 py-2 text-xs text-muted-foreground"
            >
              <Plug className="h-3 w-3" /> {r.name} — waiting…
            </div>
          );
        }
        return (
          <ConnectAccountCard
            key={r.app}
            request={r}
            onResolved={onResolved}
            stepLabel={requests.length > 1 ? `App ${i + 1} of ${requests.length}` : undefined}
          />
        );
      })}
    </div>
  );
}
