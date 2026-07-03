"use client";

import * as React from "react";
import {
  KeyRound,
  Lock,
  ExternalLink,
  CheckCircle2,
  Loader2,
  X,
  MinusCircle,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CredentialRequestState } from "@/lib/apical";

/**
 * An inline, secure key-entry box rendered in the chat when an agent calls
 * `credential_request`. The value is sent straight to the vault (encrypted at
 * rest) via /api/credentials/save-key — the agent never sees the secret, only a
 * credentialId it can reference later. The box persists with the message until
 * the user saves the key or dismisses it (state is persisted server-side).
 */
export function CredentialBox({
  request,
  onSaved,
  onDismiss,
  stepLabel,
}: {
  request: CredentialRequestState;
  onSaved?: (info: { label: string; service: string }) => void;
  onDismiss?: (info: { label: string; service: string }) => void;
  /** e.g. "Key 1 of 3" — shown when part of a sequential list. */
  stepLabel?: string;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const primaryField = request.fields[0]?.key ?? "value";

  async function save() {
    const value = (values[primaryField] ?? "").trim();
    if (!value) {
      setError("Please enter the key.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/credentials/save-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service: request.service,
          label: request.label,
          value,
          headerName: request.headerName,
          headerPrefix: request.headerPrefix,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
      }
      onSaved?.({ label: request.label, service: request.service });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (request.status === "dismissed") return null;

  if (request.status === "saved") {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span className="text-foreground">
          Saved <span className="font-medium">{request.label}</span> to the vault.
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-muted p-3 text-xs">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <KeyRound className="h-3.5 w-3.5 text-brand" />
          {request.label}
          {stepLabel && (
            <span className="text-[10px] font-normal text-muted-foreground">· {stepLabel}</span>
          )}
        </div>
        {onDismiss && (
          <button
            type="button"
            aria-label="Skip this key"
            className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
            onClick={() => onDismiss({ label: request.label, service: request.service })}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
      {request.instructions && (
        <p className="mb-2 text-muted-foreground">{request.instructions}</p>
      )}
      {request.docsUrl && (
        <a
          href={request.docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mb-2 inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-surface-hover"
        >
          Get your key <ExternalLink className="h-2.5 w-2.5" />
        </a>
      )}
      <div className="space-y-2">
        {request.fields.map((field) => (
          <div key={field.key}>
            {request.fields.length > 1 && (
              <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                {field.label}
              </label>
            )}
            <input
              type={field.type === "text" ? "text" : "password"}
              autoComplete="off"
              spellCheck={false}
              placeholder={field.placeholder ?? field.label}
              value={values[field.key] ?? ""}
              onChange={(e) =>
                setValues((v) => ({ ...v, [field.key]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
              }}
              className={cn(
                "w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-xs outline-none",
                "focus:border-foreground/20 focus:ring-1 focus:ring-primary/30",
              )}
            />
          </div>
        ))}
      </div>
      {error && <p className="mt-1.5 text-[10px] text-destructive">{error}</p>}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
          <Lock className="h-3 w-3" />
          Encrypted in your vault — never shared with the model.
        </span>
        <div className="flex items-center gap-1.5">
          {onDismiss && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 px-2.5 text-[11px] text-muted-foreground"
              disabled={saving}
              onClick={() => onDismiss({ label: request.label, service: request.service })}
            >
              Skip
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            className="h-7 px-3 text-[11px]"
            disabled={saving}
            onClick={() => void save()}
          >
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
            Save to vault
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Renders a set of credential requests as a SEQUENTIAL flow instead of a stack:
 * a checklist of every key the agent will go through, plus a single entry box
 * for the current key. Saving or skipping the current key advances to the next.
 * This keeps the user from being hit with several key boxes at once.
 */
export function CredentialRequestList({
  requests,
  onSaved,
  onDismiss,
}: {
  requests: CredentialRequestState[];
  onSaved?: (info: { label: string; service: string }) => void;
  onDismiss?: (info: { label: string; service: string }) => void;
}) {
  if (requests.length === 0) return null;

  const currentIndex = requests.findIndex(
    (r) => !r.status || r.status === "pending",
  );
  const allResolved = currentIndex === -1;
  const total = requests.length;
  const resolved = requests.filter(
    (r) => r.status === "saved" || r.status === "dismissed",
  ).length;

  // A single key needs no checklist chrome — just the box (with a Skip option).
  if (total === 1) {
    return (
      <CredentialBox
        request={requests[0]}
        onSaved={onSaved}
        onDismiss={onDismiss}
      />
    );
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="rounded-md border border-border bg-muted/50 p-2.5 text-xs">
        <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
          <KeyRound className="h-3.5 w-3.5 text-brand" />
          {allResolved
            ? `API keys (${resolved}/${total})`
            : `API keys needed — ${resolved}/${total} done`}
        </div>
        <ul className="space-y-1">
          {requests.map((r, i) => {
            const isCurrent = i === currentIndex;
            return (
              <li
                key={`${r.service}:${r.label}`}
                className={cn(
                  "flex items-center gap-1.5",
                  isCurrent ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {r.status === "saved" ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                ) : r.status === "dismissed" ? (
                  <MinusCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                ) : (
                  <Circle
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      isCurrent ? "text-brand" : "text-muted-foreground/50",
                    )}
                  />
                )}
                <span className={cn(isCurrent && "font-medium")}>{r.label}</span>
                {r.status === "saved" && (
                  <span className="text-[10px] text-emerald-500">saved</span>
                )}
                {r.status === "dismissed" && (
                  <span className="text-[10px] text-muted-foreground">skipped</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
      {!allResolved && (
        <CredentialBox
          request={requests[currentIndex]}
          stepLabel={`Key ${currentIndex + 1} of ${total}`}
          onSaved={onSaved}
          onDismiss={onDismiss}
        />
      )}
    </div>
  );
}
