"use client";

import * as React from "react";
import { KeyRound, Lock, ExternalLink, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { CredentialRequestInfo } from "@/lib/apical";

/**
 * An inline, secure key-entry box rendered in the chat when an agent calls
 * `credential_request`. The value is sent straight to the vault (encrypted at
 * rest) via /api/credentials/save-key — the agent never sees the secret, only a
 * credentialId it can reference later.
 */
export function CredentialBox({
  request,
  onSaved,
}: {
  request: CredentialRequestInfo;
  onSaved?: (info: { label: string; service: string }) => void;
}) {
  const [values, setValues] = React.useState<Record<string, string>>({});
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
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
      setSaved(true);
      onSaved?.({ label: request.label, service: request.service });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (saved) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-xs">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span className="text-foreground">
          Saved <span className="font-medium">{request.label}</span> to the vault. The agent can now use it securely.
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2 rounded-md border border-border bg-muted p-3 text-xs">
      <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
        <KeyRound className="h-3.5 w-3.5 text-brand" />
        Add {request.label}
      </div>
      {request.instructions && (
        <p className="mb-2 text-muted-foreground">{request.instructions}</p>
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
          {request.docsUrl && (
            <a
              href={request.docsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-foreground underline-offset-2 hover:underline"
            >
              Get key <ExternalLink className="h-2.5 w-2.5" />
            </a>
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
