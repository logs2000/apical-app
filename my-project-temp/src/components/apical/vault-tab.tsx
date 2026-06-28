"use client";

import * as React from "react";
import { useAppStore, type VaultSection } from "@/lib/apical/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  PlugZap,
  KeyRound,
  Monitor,
  Check,
  Plus,
  Lock,
  ShieldCheck,
  ExternalLink,
  Server,
  RefreshCw,
  Trash2,
  AlertCircle,
  Loader2,
  Search,
} from "lucide-react";

const SECTIONS: { key: VaultSection; label: string; icon: typeof PlugZap; desc: string }[] = [
  { key: "connections", label: "Connections", icon: PlugZap, desc: "OAuth integrations (Gmail, Slack, Stripe…)" },
  { key: "integrations", label: "MCP & APIs", icon: Server, desc: "MCP servers + OpenAPI integrations in use" },
  { key: "tokens", label: "Access tokens", icon: KeyRound, desc: "API tokens for MCP / REST" },
  { key: "desktop", label: "Desktop", icon: Monitor, desc: "Let agents read your files + run commands" },
];

export function VaultTab() {
  const section = useAppStore((s) => s.vaultSection);
  const setSection = useAppStore((s) => s.setVaultSection);

  return (
    <div className="flex h-full overflow-hidden">
      <nav className="hidden w-48 shrink-0 flex-col gap-0.5 border-r border-border p-2 md:flex">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            onClick={() => setSection(s.key)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors",
              section === s.key ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <s.icon className="h-3.5 w-3.5" /> {s.label}
            </span>
            <span className="pl-5 text-[10px] text-muted-foreground">{s.desc}</span>
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
          <div className="mb-4 flex gap-1 overflow-x-auto md:hidden">
            {SECTIONS.map((s) => (
              <button
                key={s.key}
                onClick={() => setSection(s.key)}
                className={cn(
                  "flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium",
                  section === s.key ? "bg-accent text-foreground" : "text-muted-foreground",
                )}
              >
                <s.icon className="h-3 w-3" /> {s.label}
              </button>
            ))}
          </div>
          {section === "connections" && <ConnectionsSection />}
          {section === "integrations" && <IntegrationsSection />}
          {section === "tokens" && <TokensSection />}
          {section === "desktop" && <DesktopSection />}
        </div>
      </div>
    </div>
  );
}

// ─── Section header ──────────────────────────────────────────────────────────

function SectionHeader({ title, sub, action }: { title: string; sub: string; action?: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>
      </div>
      {action}
    </div>
  );
}

// ─── Connections section (OAuth providers) ──────────────────────────────────

interface OAuthProvider {
  id: string;
  key: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  status: string;
  hasClientId: boolean;
  supportsCustomCreds: boolean;
  demoMode: boolean;
}

interface Credential {
  id: string;
  service: string;
  label: string;
  kind: string;
  status: string;
  oauthProvider: string | null;
  metaJson: string;
  createdAt: string;
}

function ConnectionsSection() {
  const [providers, setProviders] = React.useState<OAuthProvider[]>([]);
  const [credentials, setCredentials] = React.useState<Credential[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [provRes, credRes] = await Promise.all([
        fetch("/api/oauth/providers"),
        fetch("/api/credentials"),
      ]);
      if (provRes.ok) {
        const data = await provRes.json();
        setProviders(Array.isArray(data) ? data : data.providers || []);
      }
      if (credRes.ok) {
        const data = await credRes.json();
        setCredentials(Array.isArray(data) ? data : data.credentials || []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const connectedKeys = new Set(
    credentials.filter((c) => c.oauthProvider).map((c) => c.oauthProvider!.toLowerCase()),
  );

  return (
    <div>
      <SectionHeader
        title="Connections"
        sub="OAuth integrations. Apical stores tokens encrypted — you can revoke any time."
        action={
          <Button size="sm" variant="outline" className="gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </Button>
        }
      />
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {providers.map((p) => {
            const connected = connectedKeys.has(p.key.toLowerCase());
            const cred = credentials.find(
              (c) => c.oauthProvider?.toLowerCase() === p.key.toLowerCase(),
            );
            return (
              <div key={p.id} className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-accent text-base">
                  {p.icon || p.name[0]}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{p.name}</span>
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground">{p.category}</span>
                  </div>
                  {connected ? (
                    <div className="truncate text-[10px] text-muted-foreground">
                      {cred?.label || "Connected"} ·{" "}
                      <span className="text-emerald-600">active</span>
                    </div>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">{p.description}</div>
                  )}
                </div>
                {connected ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-[11px] text-muted-foreground"
                    onClick={() => void disconnect(p.key)}
                  >
                    Disconnect
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1 text-[11px]"
                    onClick={() => void connect(p.key, p.hasClientId, p.demoMode)}
                  >
                    <PlugZap className="h-3 w-3" /> Connect
                  </Button>
                )}
              </div>
            );
          })}
          {providers.length === 0 && !error && (
            <div className="col-span-2 rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
              No OAuth providers configured. Run <code className="rounded bg-muted px-1 py-0.5">bunx tsx prisma/seed-oauth.ts</code> to seed.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

async function connect(providerKey: string, hasClientId: boolean, demoMode: boolean) {
  try {
    if (hasClientId) {
      // Real OAuth flow — server returns an authorization URL to redirect to.
      const res = await fetch("/api/oauth/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerKey }),
      });
      const data = await res.json();
      if (data.authorizationUrl) {
        window.location.href = data.authorizationUrl;
        return;
      }
      if (data.demoMode) {
        await fetch("/api/oauth/demo-connect", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: providerKey }),
        });
        window.location.reload();
        return;
      }
    } else if (demoMode) {
      // Demo mode — simulate the connection.
      await fetch("/api/oauth/demo-connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerKey }),
      });
      window.location.reload();
    }
  } catch (err) {
    console.error("[vault] connect failed:", err);
  }
}

async function disconnect(providerKey: string) {
  try {
    await fetch("/api/oauth/disconnect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ provider: providerKey }),
    });
    window.location.reload();
  } catch (err) {
    console.error("[vault] disconnect failed:", err);
  }
}

// ─── Integrations section (MCP servers + OpenAPI integrations) ──────────────

interface Integration {
  id: string;
  name: string;
  kind: string; // "mcp" | "api" | "http"
  description: string;
  category: string;
  status: string;
  config: string;
  tools: string; // JSON array
  source: string;
  visibility: string;
  installs: number;
  createdAt: string;
  updatedAt: string;
}

interface ParsedIntegration extends Integration {
  parsedTools: Array<{ id: string; name: string; description: string }>;
  transport?: string;
  url?: string;
  specUrl?: string;
  frozenAt?: string;
}

function IntegrationsSection() {
  const [integrations, setIntegrations] = React.useState<ParsedIntegration[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [filter, setFilter] = React.useState<"all" | "mcp" | "api">("all");
  const [query, setQuery] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/integrations");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const parsed: ParsedIntegration[] = (Array.isArray(data) ? data : []).map((r: Integration) => {
        let parsedTools: ParsedIntegration["parsedTools"] = [];
        try {
          parsedTools = JSON.parse(r.tools || "[]");
        } catch {
          // ignore
        }
        let config: Record<string, unknown> = {};
        try {
          config = JSON.parse(r.config || "{}");
        } catch {
          // ignore
        }
        const mcp = config.mcp as Record<string, unknown> | undefined;
        const auth = config.auth as Record<string, unknown> | undefined;
        return {
          ...r,
          parsedTools,
          transport: mcp?.transport as string | undefined,
          url: (mcp?.url as string) || (config.url as string) || undefined,
          specUrl: config.specUrl as string | undefined,
          frozenAt: config.frozenAt as string | undefined,
          // touch auth so TS doesn't complain
          _auth: auth,
        } as ParsedIntegration & { _auth: unknown };
      });
      setIntegrations(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const filtered = integrations.filter((i) => {
    if (filter === "mcp" && i.kind !== "mcp") return false;
    if (filter === "api" && i.kind !== "api" && i.kind !== "http") return false;
    if (query && !i.name.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const mcpCount = integrations.filter((i) => i.kind === "mcp").length;
  const apiCount = integrations.filter((i) => i.kind === "api" || i.kind === "http").length;
  const frozenCount = integrations.filter((i) => i.frozenAt).length;

  return (
    <div>
      <SectionHeader
        title="MCP servers & APIs"
        sub="Discovered + in-use MCP servers and OpenAPI integrations. The agent figures these out once and freezes them for production runs."
        action={
          <Button size="sm" variant="outline" className="gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw className={cn("h-3 w-3", loading && "animate-spin")} /> Refresh
          </Button>
        }
      />

      {/* Summary stats */}
      <div className="mb-4 grid grid-cols-3 gap-2">
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">MCP servers</div>
          <div className="text-lg font-semibold tabular-nums">{mcpCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">API integrations</div>
          <div className="text-lg font-semibold tabular-nums">{apiCount}</div>
        </div>
        <div className="rounded-lg border border-border bg-card p-2.5">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Frozen</div>
          <div className="text-lg font-semibold tabular-nums">{frozenCount}</div>
        </div>
      </div>

      {/* Filter + search */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex rounded-lg border border-border bg-muted/40 p-0.5">
          {(["all", "mcp", "api"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "rounded-md px-2.5 py-1 text-[11px] font-medium uppercase transition-colors",
                filter === f ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f === "all" ? "All" : f === "mcp" ? "MCP" : "APIs"}
            </button>
          ))}
        </div>
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter by name"
            className="flex-1 bg-transparent text-[11px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center">
          <Server className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
          <p className="text-sm font-medium">No integrations yet.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Connect an MCP server or ingest an OpenAPI spec from the chat. The agent discovers + freezes integrations as it works.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((i) => (
            <IntegrationRow key={i.id} integration={i} onChanged={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function IntegrationRow({ integration, onChanged }: { integration: ParsedIntegration; onChanged: () => void }) {
  const [expanded, setExpanded] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);

  const kindIcon = integration.kind === "mcp" ? Server : PlugZap;
  const kindColor =
    integration.kind === "mcp"
      ? "bg-tool/15 text-tool-foreground"
      : "bg-accent text-foreground";

  async function remove() {
    if (!confirm(`Remove ${integration.name}? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      await fetch(`/api/integrations/${integration.id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      console.error("[vault] delete failed:", err);
    } finally {
      setDeleting(false);
    }
  }

  const toolCount = integration.parsedTools.length;

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 p-3 text-left"
      >
        <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-md", kindColor)}>
          {React.createElement(kindIcon, { className: "h-4 w-4" })}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">{integration.name}</span>
            <Badge variant="outline" className="text-[9px] uppercase">
              {integration.kind}
            </Badge>
            {integration.transport && (
              <Badge variant="outline" className="text-[9px] uppercase text-muted-foreground">
                {integration.transport}
              </Badge>
            )}
            {integration.frozenAt && (
              <Badge variant="outline" className="border-hardened/30 text-[9px] uppercase text-hardened">
                <Lock className="mr-0.5 h-2 w-2" /> Frozen
              </Badge>
            )}
          </div>
          <div className="truncate text-[11px] text-muted-foreground">
            {toolCount} tool{toolCount === 1 ? "" : "s"}
            {integration.url ? ` · ${integration.url}` : ""}
            {integration.specUrl ? ` · spec` : ""}
          </div>
        </div>
        <span className="text-[10px] text-muted-foreground">
          {expanded ? "−" : "+"}
        </span>
      </button>
      {expanded && (
        <div className="border-t border-border p-3">
          <p className="text-[11px] text-muted-foreground">{integration.description}</p>
          {integration.parsedTools.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Tools
              </div>
              <div className="space-y-1">
                {integration.parsedTools.slice(0, 12).map((t) => (
                  <div key={t.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1">
                    <code className="text-[10px] font-mono text-foreground">{t.id}</code>
                    <span className="truncate text-[10px] text-muted-foreground">{t.name}</span>
                  </div>
                ))}
                {integration.parsedTools.length > 12 && (
                  <div className="text-[10px] text-muted-foreground">
                    + {integration.parsedTools.length - 12} more…
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground">
              Added {new Date(integration.createdAt).toLocaleDateString()}
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 text-[11px] text-destructive"
              onClick={remove}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />} Remove
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tokens section ─────────────────────────────────────────────────────────

function TokensSection() {
  const [tokens, setTokens] = React.useState<Array<{ id: string; label: string; tokenPrefix: string; lastUsedAt: string | null; status: string; createdAt: string }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [newLabel, setNewLabel] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [newKey, setNewKey] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/tokens");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setTokens(data.tokens || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function createToken() {
    if (!newLabel.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/tokens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setNewKey(data.raw || "(created)");
      setNewLabel("");
      void load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setCreating(false);
    }
  }

  async function revokeToken(id: string) {
    if (!confirm("Revoke this token? This cannot be undone.")) return;
    try {
      await fetch(`/api/tokens/${id}`, { method: "DELETE" });
      void load();
    } catch (err) {
      console.error("[vault] revoke failed:", err);
    }
  }

  return (
    <div>
      <SectionHeader
        title="Access tokens"
        sub="Use these tokens to authenticate MCP servers, the Apical CLI, or custom API calls."
        action={null}
      />
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}
      {newKey && (
        <div className="mb-3 rounded-md border border-border bg-muted p-3">
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold text-foreground">
            <ShieldCheck className="h-3.5 w-3.5" /> Token created — copy now, it won't be shown again.
          </div>
          <code className="block break-all rounded bg-background p-2 font-mono text-[11px]">{newKey}</code>
          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-7 text-[11px]"
            onClick={() => {
              navigator.clipboard.writeText(newKey);
              setNewKey(null);
            }}
          >
            Copy & dismiss
          </Button>
        </div>
      )}
      <div className="mb-3 flex items-center gap-2">
        <Input
          value={newLabel}
          onChange={(e) => setNewLabel(e.target.value)}
          placeholder="Token label (e.g. Production, Local dev)"
          className="h-8 text-xs"
        />
        <Button size="sm" className="gap-1.5" onClick={createToken} disabled={creating || !newLabel.trim()}>
          {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} New token
        </Button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : tokens.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
          No tokens yet. Create one above.
        </div>
      ) : (
        <div className="space-y-2">
          {tokens.map((t) => (
            <div key={t.id} className="rounded-lg border border-border bg-card p-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-medium">{t.label}</span>
                  {t.status === "revoked" && (
                    <Badge variant="outline" className="text-[9px] uppercase text-destructive">Revoked</Badge>
                  )}
                </div>
                {t.status !== "revoked" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-[10px] text-destructive"
                    onClick={() => revokeToken(t.id)}
                  >
                    Revoke
                  </Button>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 p-2">
                <KeyRound className="h-3 w-3 shrink-0 text-muted-foreground" />
                <code className="flex-1 truncate font-mono text-[11px]">{t.tokenPrefix}…</code>
              </div>
              <div className="mt-1.5 flex items-center gap-3 text-[10px] text-muted-foreground">
                <span>Created {new Date(t.createdAt).toLocaleDateString()}</span>
                <span>·</span>
                <span>{t.lastUsedAt ? `Last used ${new Date(t.lastUsedAt).toLocaleDateString()}` : "Never used"}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Desktop section ────────────────────────────────────────────────────────

function DesktopSection() {
  return (
    <div>
      <SectionHeader
        title="Desktop bridge"
        sub="Connect the Apical desktop app so agents can read your files and run commands on this machine."
        action={null}
      />
      <div className="rounded-lg border border-dashed border-border bg-muted p-5 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-foreground">
          <Monitor className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold">Desktop app not connected</h3>
        <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
          Install the Apical desktop app (Tauri) to let agents access your filesystem, run shell commands, and use local MCP servers.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Button size="sm" className="gap-1.5">
            <Monitor className="h-3 w-3" /> Download desktop app
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5">
            <ExternalLink className="h-3 w-3" /> Docs
          </Button>
        </div>
      </div>
      <div className="mt-4 rounded-lg border border-border bg-card p-4">
        <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
          <ShieldCheck className="h-3.5 w-3.5 text-brand" /> What agents can do with desktop access
        </div>
        <ul className="space-y-1.5 text-[11px] text-muted-foreground">
          <li className="flex gap-2"><Check className="h-3 w-3 shrink-0 text-foreground" /> Read + write files in folders you approve</li>
          <li className="flex gap-2"><Check className="h-3 w-3 shrink-0 text-foreground" /> Run shell commands (gated — you approve each one)</li>
          <li className="flex gap-2"><Check className="h-3 w-3 shrink-0 text-foreground" /> Spawn local MCP servers (filesystem, GitHub, etc.)</li>
          <li className="flex gap-2"><Check className="h-3 w-3 shrink-0 text-foreground" /> Access local network resources (databases, internal APIs)</li>
        </ul>
      </div>
    </div>
  );
}

void Input;
void Label;
