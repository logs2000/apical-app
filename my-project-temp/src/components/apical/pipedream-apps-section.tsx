"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Check,
  Loader2,
  AlertCircle,
  Search,
  Plug,
  Trash2,
  Settings2,
} from "lucide-react";
import {
  openPipedreamConnect,
  type ConnectedAccountInfo,
} from "@/lib/apical/pipedream-connect-client";

/**
 * The primary connections surface: search Pipedream's 3,000+ app catalog and
 * connect accounts through managed auth. Direct OAuth / MCP / OpenAPI live in
 * the other vault sections as the advanced path.
 */

interface CatalogApp {
  slug: string;
  name: string;
  imgSrc: string | null;
  authType: string | null;
  description: string | null;
  categories: string[];
  connected: boolean;
  credentialId: string | null;
}

interface ConnectedRow {
  credentialId: string;
  app: string | null;
  label: string;
  status: string;
}

export function PipedreamAppsSection() {
  const [configured, setConfigured] = React.useState<boolean | null>(null);
  const [query, setQuery] = React.useState("");
  const [apps, setApps] = React.useState<CatalogApp[]>([]);
  const [connected, setConnected] = React.useState<ConnectedRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [busySlug, setBusySlug] = React.useState<string | null>(null);

  const loadConnected = React.useCallback(async () => {
    try {
      const res = await fetch("/api/pipedream/accounts");
      if (!res.ok) return;
      const body = (await res.json()) as { accounts?: ConnectedRow[]; configured?: boolean };
      setConnected(body.accounts ?? []);
    } catch {
      // Non-fatal — the catalog still renders.
    }
  }, []);

  // Configured check + initial featured apps + connected accounts.
  React.useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/pipedream/status");
        const body = (await res.json()) as { configured?: boolean };
        if (cancelled) return;
        setConfigured(Boolean(body.configured));
        if (body.configured) void loadConnected();
      } catch {
        if (!cancelled) setConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadConnected]);

  // Debounced catalog search (empty query = featured apps).
  React.useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    const t = setTimeout(() => {
      if (cancelled) return;
      setLoading(true);
      void (async () => {
        try {
          const res = await fetch(`/api/pipedream/apps?q=${encodeURIComponent(query.trim())}`);
          const body = (await res.json()) as { apps?: CatalogApp[]; error?: string };
          if (cancelled) return;
          if (!res.ok) {
            setError(body.error || "App search failed.");
            setApps([]);
          } else {
            setError(null);
            setApps(body.apps ?? []);
          }
        } catch {
          if (!cancelled) setError("App search failed.");
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [configured, query]);

  function connect(app: CatalogApp) {
    setBusySlug(app.slug);
    setError(null);
    void openPipedreamConnect({
      app: app.slug,
      onSuccess: (info: ConnectedAccountInfo) => {
        setBusySlug(null);
        setApps((prev) =>
          prev.map((a) =>
            a.slug === info.app ? { ...a, connected: true, credentialId: info.credentialId } : a,
          ),
        );
        void loadConnected();
      },
      onError: (message) => {
        setBusySlug(null);
        setError(message);
      },
      onCancel: () => setBusySlug(null),
    });
  }

  async function disconnect(credentialId: string, slug?: string | null) {
    setBusySlug(slug ?? credentialId);
    try {
      const res = await fetch(`/api/pipedream/accounts/${credentialId}`, { method: "DELETE" });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error || "Failed to disconnect.");
        return;
      }
      setApps((prev) =>
        prev.map((a) => (a.credentialId === credentialId ? { ...a, connected: false, credentialId: null } : a)),
      );
      void loadConnected();
    } finally {
      setBusySlug(null);
    }
  }

  if (configured === null) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading apps…
      </div>
    );
  }

  if (!configured) {
    return (
      <div>
        <SectionHeading />
        <div className="rounded-lg border border-border bg-muted/50 p-4 text-sm">
          <div className="mb-1 flex items-center gap-2 font-medium">
            <Settings2 className="h-4 w-4 text-brand" /> Managed connections aren&apos;t set up yet
          </div>
          <p className="text-xs text-muted-foreground">
            Set <code>PIPEDREAM_CLIENT_ID</code>, <code>PIPEDREAM_CLIENT_SECRET</code> and{" "}
            <code>PIPEDREAM_PROJECT_ID</code> to enable one-click connections to 3,000+ apps.
            Until then, use <span className="font-medium">Direct connections</span> and{" "}
            <span className="font-medium">MCP &amp; APIs</span> in the sidebar — they work
            independently of the managed path.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeading />

      {connected.length > 0 && (
        <div className="mb-5">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Connected
          </h3>
          <div className="flex flex-col gap-1.5">
            {connected.map((row) => (
              <div
                key={row.credentialId}
                className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
              >
                <span className="flex items-center gap-2">
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="font-medium">{row.label}</span>
                  {row.app && (
                    <span className="text-[11px] text-muted-foreground">{row.app}</span>
                  )}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-muted-foreground hover:text-destructive"
                  disabled={busySlug === (row.app ?? row.credentialId)}
                  onClick={() => void disconnect(row.credentialId, row.app)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search 3,000+ apps (Slack, Notion, QuickBooks…)"
          className="h-9 pl-8 text-sm"
        />
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching…
        </div>
      ) : apps.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No apps found{query.trim() ? ` for “${query.trim()}”` : ""}.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {apps.map((app) => (
            <div
              key={app.slug}
              className="flex items-center justify-between gap-2 rounded-lg border border-border p-3"
            >
              <div className="flex min-w-0 items-center gap-2.5">
                {app.imgSrc ? (
                  <img src={app.imgSrc} alt="" className="h-7 w-7 shrink-0 rounded" />
                ) : (
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded bg-muted">
                    <Plug className="h-3.5 w-3.5 text-muted-foreground" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-sm font-medium">
                    <span className="truncate">{app.name}</span>
                    {app.connected && (
                      <Badge variant="secondary" className="h-4 px-1 text-[9px]">
                        Connected
                      </Badge>
                    )}
                  </div>
                  {app.description && (
                    <p className="truncate text-[11px] text-muted-foreground">{app.description}</p>
                  )}
                </div>
              </div>
              {app.connected && app.credentialId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 shrink-0 px-2 text-xs text-muted-foreground hover:text-destructive"
                  disabled={busySlug === app.slug}
                  onClick={() => void disconnect(app.credentialId as string, app.slug)}
                >
                  Disconnect
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="h-7 shrink-0 px-2.5 text-xs"
                  disabled={busySlug === app.slug}
                  onClick={() => connect(app)}
                >
                  {busySlug === app.slug ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    "Connect"
                  )}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SectionHeading() {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold tracking-tight">Apps</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Connect the tools you use — one click, managed auth, 3,000+ apps. Agents can use every
        connection you add here.
      </p>
    </div>
  );
}
