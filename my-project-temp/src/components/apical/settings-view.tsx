"use client";

import * as React from "react";
import { useAppStore } from "@/lib/apical/store";
import { useAuth } from "@/components/auth/AuthDialog";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  User,
  Building2,
  Bell,
  Palette,
  ShieldCheck,
  LogOut,
  Cpu,
  Plus,
  Search,
  ChevronDown,
  ChevronRight,
  Loader2,
  Check,
  AlertCircle,
  KeyRound,
  Lock,
} from "lucide-react";

interface ModelEntry {
  id: string;
  name: string;
  provider: string;
  tier: string;
  contextWindow: number;
  description: string;
  badge?: string;
  configured: boolean;
  custom?: boolean;
  enabled?: boolean;
  isDefault?: boolean;
  apiModelId?: string;
  baseUrl?: string | null;
  byokKeyId?: string | null;
  inputCostCentsPer1M?: number;
  outputCostCentsPer1M?: number;
}

interface ByokKey {
  id: string;
  provider: string;
  label: string;
  keyPrefix: string;
  baseUrl: string | null;
  defaultModel: string | null;
  status: string;
  lastStatus: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
}

export function SettingsView() {
  const setMode = useAppStore((s) => s.setMode);
  const { user, signOut } = useAuth();
  const [name, setName] = React.useState(user?.name ?? "Jordan Doe");
  const [email, setEmail] = React.useState(user?.email ?? "jordan@example.com");
  const [company, setCompany] = React.useState("Apical Demo Co.");
  const [industry, setIndustry] = React.useState("Professional services");
  const [notes, setNotes] = React.useState("Sort client docs daily. Chase invoices weekly. Audit expenses monthly.");
  const [nameStyle, setNameStyle] = React.useState<"evocative" | "descriptive">("evocative");
  const [emailDaily, setEmailDaily] = React.useState(true);
  const [emailFlagged, setEmailFlagged] = React.useState(true);
  const [emailErrors, setEmailErrors] = React.useState(false);

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-2xl px-4 py-5 md:px-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold tracking-tight">Settings</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Profile, company, models, notifications, and appearance.</p>
        </div>

        {/* Profile */}
        <Section icon={User} title="Profile">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
        </Section>

        {/* Models (NEW — moved here from the Vault tab) */}
        <Section icon={Cpu} title="Models">
          <ModelsManager />
        </Section>

        {/* Company */}
        <Section icon={Building2} title="Company">
          <p className="mb-3 text-[11px] text-muted-foreground">
            Apical uses this to tailor agent suggestions to your business.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Company name</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Industry</Label>
              <Input value={industry} onChange={(e) => setIndustry(e.target.value)} className="h-9 text-sm" />
            </div>
          </div>
          <div className="mt-3 space-y-1.5">
            <Label className="text-xs">Notes for the agent</Label>
            <Textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="text-sm"
              placeholder="Tell Apical what you do, what tools you use, what recurring jobs you have…"
            />
          </div>
        </Section>

        {/* Agent naming */}
        <Section icon={Palette} title="Agent naming">
          <p className="mb-3 text-[11px] text-muted-foreground">
            How Apical names new agents when it hires them.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["evocative", "descriptive"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setNameStyle(s)}
                className={cn(
                  "rounded-lg border p-3 text-left transition",
                  nameStyle === s ? "border-primary/50 bg-primary/5" : "border-border hover:border-border/80",
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold capitalize">{s}</span>
                  {nameStyle === s && <Badge variant="outline" className="border-primary/30 text-primary">Selected</Badge>}
                </div>
                <div className="mt-1 text-[10px] text-muted-foreground">
                  {s === "evocative" ? "Short, friendly names like Compass, Atlas, Sentinel" : "Job-derived names like SortAgent, InvoiceAgent"}
                </div>
              </button>
            ))}
          </div>
        </Section>

        {/* Notifications */}
        <Section icon={Bell} title="Notifications">
          <div className="space-y-2">
            <Toggle label="Daily summary" desc="A short digest each morning of what your agents did." checked={emailDaily} onChange={setEmailDaily} />
            <Toggle label="Flagged items" desc="When an agent flags something for your review." checked={emailFlagged} onChange={setEmailFlagged} />
            <Toggle label="Errors only" desc="Only when an agent fails a run." checked={emailErrors} onChange={setEmailErrors} />
          </div>
        </Section>

        {/* Security */}
        <Section icon={ShieldCheck} title="Security">
          <div className="space-y-2">
            <Row label="Password" value="••••••••" action={<Button size="sm" variant="outline" className="h-7 text-[11px]">Change</Button>} />
            <Row label="Two-factor auth" value="Not enabled" action={<Button size="sm" variant="outline" className="h-7 text-[11px]">Enable</Button>} />
            <Row label="Active sessions" value="1 (this browser)" action={<Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground">View</Button>} />
          </div>
        </Section>

        {/* Danger zone */}
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
          <h3 className="text-sm font-semibold text-destructive">Account</h3>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" onClick={signOut}>
              <LogOut className="h-3 w-3" /> Sign out
            </Button>
            <Button size="sm" variant="ghost" className="text-destructive">
              Delete account
            </Button>
          </div>
        </div>

        {/* Save bar */}
        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <Button variant="ghost" size="sm" onClick={() => setMode("agents")}>
            Cancel
          </Button>
          <Button size="sm">Save changes</Button>
        </div>
      </div>
    </div>
  );
}

// ─── Models manager ─────────────────────────────────────────────────────────

function ModelsManager() {
  const [models, setModels] = React.useState<ModelEntry[]>([]);
  const [byokKeys, setByokKeys] = React.useState<ByokKey[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [search, setSearch] = React.useState("");
  const [showAdd, setShowAdd] = React.useState(false);
  const [showKeys, setShowKeys] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [modelsRes, keysRes] = await Promise.all([
        fetch("/api/llm/models"),
        fetch("/api/byok"),
      ]);
      if (modelsRes.ok) {
        const data = await modelsRes.json();
        setModels(data.models || []);
      }
      if (keysRes.ok) {
        const data = await keysRes.json();
        setByokKeys(data.keys || []);
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

  async function toggleModel(model: ModelEntry) {
    // For custom models, PATCH enabled. For registry models, we can't toggle
    // server-side (they're always "available") — this is a UI-only toggle.
    if (model.custom && model.id) {
      try {
        await fetch(`/api/llm/models/${model.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: !model.enabled }),
        });
        void load();
      } catch (err) {
        console.error("[settings] toggle failed:", err);
      }
    } else {
      // Local UI toggle for registry models.
      setModels((prev) =>
        prev.map((m) => (m.id === model.id ? { ...m, enabled: !m.enabled } : m)),
      );
    }
  }

  async function setDefault(model: ModelEntry) {
    if (!model.custom || !model.id) return;
    try {
      await fetch(`/api/llm/models/${model.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      void load();
    } catch (err) {
      console.error("[settings] setDefault failed:", err);
    }
  }

  const filtered = models.filter(
    (m) =>
      !search ||
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.provider.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div>
      <p className="mb-3 text-[11px] text-muted-foreground">
        AI models Apical can use to reason. Bring your own keys — your data never leaves your account. Toggle models on/off to control which appear in the agent picker.
      </p>
      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5" /> {error}
        </div>
      )}
      {/* Search + add */}
      <div className="mb-3 flex items-center gap-2">
        <div className="flex flex-1 items-center gap-1.5 rounded-md border border-border bg-background px-2 py-1.5">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Add or search model"
            className="flex-1 bg-transparent text-[11px] placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setShowAdd((v) => !v)}>
          <Plus className="h-3 w-3" /> Add custom
        </Button>
      </div>
      {/* Add custom model form */}
      {showAdd && <AddCustomModelForm byokKeys={byokKeys} onDone={() => { setShowAdd(false); void load(); }} />}
      {/* Model list */}
      {loading ? (
        <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-md border border-dashed border-border p-4 text-center text-[11px] text-muted-foreground">
          No models match.
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((m) => (
            <ModelRow
              key={m.id}
              model={m}
              onToggle={() => toggleModel(m)}
              onSetDefault={() => setDefault(m)}
            />
          ))}
        </div>
      )}
      {/* API keys collapsible */}
      <button
        onClick={() => setShowKeys((v) => !v)}
        className="mt-4 flex w-full items-center gap-1.5 rounded-md border border-border bg-muted/30 px-3 py-2 text-left text-xs font-medium"
      >
        {showKeys ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <KeyRound className="h-3.5 w-3.5" /> API Keys
        <Badge variant="outline" className="ml-auto text-[9px]">{byokKeys.length}</Badge>
      </button>
      {showKeys && <ByokKeysManager keys={byokKeys} onChanged={load} />}
    </div>
  );
}

function ModelRow({
  model,
  onToggle,
  onSetDefault,
}: {
  model: ModelEntry;
  onToggle: () => void;
  onSetDefault: () => void;
}) {
  const enabled = model.enabled !== false; // default to enabled
  const tierBadge =
    model.tier === "hosted" ? "Hosted" : model.tier === "byok" ? "BYOK" : model.tier === "local" ? "Local" : model.tier;
  const tierColor =
    model.tier === "hosted"
      ? "border-primary/30 text-primary"
      : model.tier === "byok"
        ? "border-amber-500/30 text-amber-600"
        : "border-emerald-500/30 text-emerald-600";

  return (
    <div className="group flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 hover:border-border/80">
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground")}>
        <Cpu className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{model.name}</span>
          {model.isDefault && (
            <Badge variant="outline" className="border-primary/30 text-[9px] text-primary">
              <Check className="mr-0.5 h-2 w-2" /> Default
            </Badge>
          )}
          {model.badge && (
            <Badge variant="outline" className="text-[9px] capitalize">{model.badge}</Badge>
          )}
        </div>
        <div className="truncate text-[10px] text-muted-foreground">
          {model.provider} · {model.contextWindow.toLocaleString()} ctx
          {!model.configured && model.tier === "byok" && " · add key to enable"}
        </div>
      </div>
      <Badge variant="outline" className={cn("text-[9px] uppercase", tierColor)}>{tierBadge}</Badge>
      {model.custom && !model.isDefault && (
        <Button
          size="sm"
          variant="ghost"
          className="h-6 shrink-0 text-[10px] text-muted-foreground"
          onClick={onSetDefault}
          title="Set as default"
        >
          Set default
        </Button>
      )}
      {/* Toggle */}
      <button
        onClick={onToggle}
        className={cn(
          "relative h-4 w-7 shrink-0 rounded-full transition-colors",
          enabled ? "bg-primary" : "bg-muted",
        )}
        title={enabled ? "Enabled — click to disable" : "Disabled — click to enable"}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3 w-3 rounded-full bg-background shadow transition-transform",
            enabled ? "left-[14px]" : "left-0.5",
          )}
        />
      </button>
    </div>
  );
}

function AddCustomModelForm({ byokKeys, onDone }: { byokKeys: ByokKey[]; onDone: () => void }) {
  const [name, setName] = React.useState("");
  const [modelId, setModelId] = React.useState("");
  const [provider, setProvider] = React.useState("openai");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [byokKeyId, setByokKeyId] = React.useState("");
  const [contextWindow, setContextWindow] = React.useState("128000");
  const [isDefault, setIsDefault] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function save() {
    if (!name.trim() || !modelId.trim()) {
      setError("Name and model ID are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/llm/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          type: "hosted", // user-added = treated as hosted for routing
          provider: provider.trim(),
          modelId: modelId.trim(),
          baseUrl: baseUrl.trim() || undefined,
          byokKeyId: byokKeyId.trim() || undefined,
          isDefault,
          contextWindow: parseInt(contextWindow, 10) || 128000,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mb-3 rounded-md border border-border bg-muted/30 p-3">
      <div className="mb-2 text-[11px] font-semibold">Add a custom model</div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <Label className="text-[10px]">Display name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-xs" placeholder="e.g. My Fine-tuned GPT" />
        </div>
        <div>
          <Label className="text-[10px]">Model ID (API)</Label>
          <Input value={modelId} onChange={(e) => setModelId(e.target.value)} className="h-8 text-xs" placeholder="gpt-4o-mini" />
        </div>
        <div>
          <Label className="text-[10px]">Provider</Label>
          <Input value={provider} onChange={(e) => setProvider(e.target.value)} className="h-8 text-xs" placeholder="openai" />
        </div>
        <div>
          <Label className="text-[10px]">Base URL (optional)</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} className="h-8 text-xs" placeholder="https://api.openai.com/v1" />
        </div>
        <div>
          <Label className="text-[10px]">BYOK key (optional)</Label>
          <select
            value={byokKeyId}
            onChange={(e) => setByokKeyId(e.target.value)}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="">None</option>
            {byokKeys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label} ({k.keyPrefix}…)
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[10px]">Context window</Label>
          <Input value={contextWindow} onChange={(e) => setContextWindow(e.target.value)} className="h-8 text-xs" placeholder="128000" />
        </div>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-[11px]">
          <input type="checkbox" checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />
          Set as default
        </label>
        {error && <span className="text-[11px] text-destructive">{error}</span>}
      </div>
      <div className="mt-2 flex gap-2">
        <Button size="sm" className="gap-1.5" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Save model
        </Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
    </div>
  );
}

function ByokKeysManager({ keys, onChanged }: { keys: ByokKey[]; onChanged: () => void }) {
  const [provider, setProvider] = React.useState("openai");
  const [label, setLabel] = React.useState("");
  const [key, setKey] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function addKey() {
    if (!provider.trim() || !label.trim() || !key.trim()) {
      setError("Provider, label, and key are required");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/byok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: provider.trim(),
          label: label.trim(),
          key: key.trim(),
          baseUrl: baseUrl.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setLabel("");
      setKey("");
      setBaseUrl("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function revokeKey(id: string) {
    if (!confirm("Revoke this API key?")) return;
    try {
      await fetch(`/api/byok/${id}`, { method: "DELETE" });
      onChanged();
    } catch (err) {
      console.error("[settings] revoke key failed:", err);
    }
  }

  return (
    <div className="mt-2 space-y-2 rounded-md border border-border bg-card p-3">
      {/* Existing keys */}
      {keys.length === 0 ? (
        <div className="text-[11px] text-muted-foreground">No API keys yet. Add one below.</div>
      ) : (
        <div className="space-y-1">
          {keys.map((k) => (
            <div key={k.id} className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-2 py-1.5">
              <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[11px] font-medium">{k.label}</div>
                <div className="text-[10px] text-muted-foreground">
                  {k.provider} · {k.keyPrefix}… · {k.status}
                </div>
              </div>
              <Button size="sm" variant="ghost" className="h-6 text-[10px] text-destructive" onClick={() => revokeKey(k.id)}>
                Revoke
              </Button>
            </div>
          ))}
        </div>
      )}
      {/* Add key form */}
      <div className="border-t border-border pt-2">
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Add API key</div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="Provider (openai, anthropic, …)" className="h-8 text-xs" />
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (e.g. Production)" className="h-8 text-xs" />
          <Input value={key} onChange={(e) => setKey(e.target.value)} placeholder="sk-…" className="h-8 text-xs" type="password" />
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="Base URL (optional)" className="h-8 text-xs" />
        </div>
        {error && <div className="mt-1 text-[10px] text-destructive">{error}</div>}
        <Button size="sm" className="mt-2 gap-1.5" onClick={addKey} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Add key
        </Button>
      </div>
    </div>
  );
}

// ─── Section primitives ─────────────────────────────────────────────────────

function Section({ icon: Icon, title, children }: { icon: typeof User; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-5 rounded-lg border border-border bg-card p-4">
      <h3 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3.5 w-3.5" /> {title}
      </h3>
      {children}
    </div>
  );
}

function Toggle({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[10px] text-muted-foreground">{desc}</div>
      </div>
      <button
        onClick={() => onChange(!checked)}
        className={cn("relative h-5 w-9 shrink-0 rounded-full transition-colors", checked ? "bg-primary" : "bg-muted")}
      >
        <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-background shadow transition-transform", checked ? "left-[18px]" : "left-0.5")} />
      </button>
    </div>
  );
}

function Row({ label, value, action }: { label: string; value: string; action: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5">
      <div>
        <div className="text-xs font-medium">{label}</div>
        <div className="text-[10px] text-muted-foreground">{value}</div>
      </div>
      {action}
    </div>
  );
}
