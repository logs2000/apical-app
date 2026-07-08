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
  ScrollText,
  Monitor,
  Trash2,
  SlidersHorizontal,
} from "lucide-react";
import { RunLog } from "./workflow-runs-console";
import { IS_TAURI } from "@/lib/desktop/tauri-bridge";

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

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-2xl px-4 py-5 md:px-6">
        <div className="mb-5">
          <h2 className="text-base font-semibold tracking-tight">Settings</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Profile, company, models, notifications, and security.</p>
        </div>

        {/* Profile — from the signed-in account */}
        <Section icon={User} title="Profile">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={user?.name ?? ""} readOnly disabled className="h-9 text-sm" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input value={user?.email ?? ""} readOnly disabled className="h-9 text-sm" />
            </div>
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">
            Name and email come from your login account.
          </p>
        </Section>

        {/* Models (NEW — moved here from the Vault tab) */}
        <Section icon={Cpu} title="Models">
          <CloudApicalLink />
          <ModelsManager />
        </Section>

        <DesktopAccessSection />

        {/* Workflow run log */}
        <Section icon={ScrollText} title="Run log">
          <p className="mb-3 text-[11px] text-muted-foreground">
            Same auditable run log as Activity — all agents, filterable and expandable.
          </p>
          <RunLog limit={50} />
        </Section>

        <CompanySection />

        <AgentNamingSection />

        <NotificationsSection />

        <AdminTokenLimitsSection />

        <SecuritySection userEmail={user?.email ?? null} />

        <DangerZone signOut={signOut} />

        <div className="mt-6 flex items-center justify-start border-t border-border pt-4">
          <Button variant="ghost" size="sm" onClick={() => setMode("agents")}>
            Back to app
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Company (persisted via /api/profile) ────────────────────────────────────

function CompanySection() {
  const [company, setCompany] = React.useState("");
  const [industry, setIndustry] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [loaded, setLoaded] = React.useState(false);
  const [dirty, setDirty] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [savedAt, setSavedAt] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { companyName?: string; industry?: string; notes?: string } | null) => {
        if (cancelled || !data) return;
        setCompany(data.companyName ?? "");
        setIndustry(data.industry ?? "");
        setNotes(data.notes ?? "");
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    return () => {
      cancelled = true;
    };
  }, []);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyName: company, industry, notes }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Save failed (${res.status})`);
      }
      setDirty(false);
      setSavedAt(Date.now());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section icon={Building2} title="Company">
      <p className="mb-3 text-[11px] text-muted-foreground">
        Apical uses this to tailor agent suggestions to your business.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Company name</Label>
          <Input
            value={company}
            disabled={!loaded}
            onChange={(e) => { setCompany(e.target.value); setDirty(true); }}
            className="h-9 text-sm"
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Industry</Label>
          <Input
            value={industry}
            disabled={!loaded}
            onChange={(e) => { setIndustry(e.target.value); setDirty(true); }}
            className="h-9 text-sm"
          />
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        <Label className="text-xs">Notes for the agent</Label>
        <Textarea
          value={notes}
          disabled={!loaded}
          onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
          rows={3}
          className="text-sm"
          placeholder="Tell Apical what you do, what tools you use, what recurring jobs you have…"
        />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <Button size="sm" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
          Save
        </Button>
        {savedAt && !dirty && (
          <span className="text-[10px] text-muted-foreground">Saved</span>
        )}
        {error && <span className="text-[10px] text-destructive">{error}</span>}
      </div>
    </Section>
  );
}

// ─── Agent naming (persisted via /api/profile.agentNameStyle) ────────────────

function AgentNamingSection() {
  const [nameStyle, setNameStyle] = React.useState<"evocative" | "descriptive" | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/profile")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { agentNameStyle?: string } | null) => {
        if (cancelled) return;
        setNameStyle(data?.agentNameStyle === "evocative" ? "evocative" : "descriptive");
      })
      .catch(() => setNameStyle("descriptive"));
    return () => {
      cancelled = true;
    };
  }, []);

  async function select(style: "evocative" | "descriptive") {
    const prev = nameStyle;
    setNameStyle(style);
    setError(null);
    try {
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentNameStyle: style }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (err) {
      setNameStyle(prev);
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Section icon={Palette} title="Agent naming">
      <p className="mb-3 text-[11px] text-muted-foreground">
        How Apical names new agents when it creates them.
      </p>
      <div className="grid grid-cols-2 gap-2">
        {(["evocative", "descriptive"] as const).map((s) => (
          <button
            key={s}
            onClick={() => void select(s)}
            disabled={nameStyle === null}
            className={cn(
              "rounded-lg border p-3 text-left transition",
              nameStyle === s ? "border-foreground/20 bg-muted" : "border-border hover:border-border/80",
            )}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold capitalize">{s}</span>
              {nameStyle === s && <Badge variant="outline" className="border-border text-foreground">Selected</Badge>}
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              {s === "evocative" ? "Short, friendly names like Compass, Atlas, Sentinel" : "Job-derived names like SortAgent, InvoiceAgent"}
            </div>
          </button>
        ))}
      </div>
      {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}
    </Section>
  );
}

// ─── Notifications (persisted via /api/notifications/preferences) ────────────

const NOTIFICATION_TOGGLES: Array<{ key: string; label: string; desc: string }> = [
  { key: "daily_brief", label: "Daily brief", desc: "A short digest each morning of what your agents did." },
  { key: "weekly_brief", label: "Weekly brief", desc: "A weekly roll-up of runs, savings, and flagged items." },
  { key: "flagged", label: "Flagged items", desc: "When an agent flags something for your review." },
  { key: "gate", label: "Approvals", desc: "When an agent is waiting on you to approve a gated step." },
  { key: "schedule", label: "Scheduled runs", desc: "Outcomes of scheduled agent runs (including failures)." },
  { key: "billing", label: "Billing", desc: "Receipts, plan changes, and usage warnings." },
];

function NotificationsSection() {
  const [prefs, setPrefs] = React.useState<Record<string, boolean> | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    void fetch("/api/notifications/preferences")
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Record<string, boolean> | null) => {
        if (!cancelled) setPrefs(data ?? {});
      })
      .catch(() => setPrefs({}));
    return () => {
      cancelled = true;
    };
  }, []);

  async function toggle(key: string, value: boolean) {
    const prev = prefs;
    setPrefs((p) => ({ ...(p ?? {}), [key]: value }));
    setError(null);
    try {
      const res = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefs: { [key]: value } }),
      });
      if (!res.ok) throw new Error(`Save failed (${res.status})`);
    } catch (err) {
      setPrefs(prev);
      setError(err instanceof Error ? err.message : "Save failed");
    }
  }

  return (
    <Section icon={Bell} title="Email notifications">
      {prefs === null ? (
        <div className="flex items-center gap-2 py-3 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2">
          {NOTIFICATION_TOGGLES.map((t) => (
            <Toggle
              key={t.key}
              label={t.label}
              desc={t.desc}
              checked={prefs[t.key] !== false}
              onChange={(v) => void toggle(t.key, v)}
            />
          ))}
        </div>
      )}
      {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}
    </Section>
  );
}

// ─── Security (real password reset + global sign-out) ────────────────────────

function SecuritySection({ userEmail }: { userEmail: string | null }) {
  const [resetState, setResetState] = React.useState<"idle" | "sending" | "sent" | "error">("idle");
  const [signOutAllState, setSignOutAllState] = React.useState<"idle" | "working" | "done" | "error">("idle");

  async function sendReset() {
    if (!userEmail) return;
    setResetState("sending");
    try {
      const res = await fetch("/api/auth/reset-password/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: userEmail }),
      });
      setResetState(res.ok ? "sent" : "error");
    } catch {
      setResetState("error");
    }
  }

  async function signOutEverywhere() {
    setSignOutAllState("working");
    try {
      const { createClient } = await import("@/lib/supabase/client");
      const supabase = createClient();
      if (!supabase) throw new Error("Auth not configured");
      const { error } = await supabase.auth.signOut({ scope: "global" });
      if (error) throw error;
      setSignOutAllState("done");
      window.location.assign("/login");
    } catch {
      setSignOutAllState("error");
    }
  }

  return (
    <Section icon={ShieldCheck} title="Security">
      <div className="space-y-2">
        <Row
          label="Password"
          value={
            resetState === "sent"
              ? "Reset link sent — check your email"
              : resetState === "error"
                ? "Could not send the reset email"
                : "Change it via an emailed reset link"
          }
          action={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => void sendReset()}
              disabled={!userEmail || resetState === "sending" || resetState === "sent"}
            >
              {resetState === "sending" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : resetState === "sent" ? (
                "Sent"
              ) : (
                "Send reset link"
              )}
            </Button>
          }
        />
        <Row
          label="Sessions"
          value={
            signOutAllState === "error"
              ? "Could not sign out other sessions"
              : "Sign out of Apical on every device"
          }
          action={
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-[11px]"
              onClick={() => void signOutEverywhere()}
              disabled={signOutAllState === "working"}
            >
              {signOutAllState === "working" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                "Sign out everywhere"
              )}
            </Button>
          }
        />
      </div>
    </Section>
  );
}

// ─── Danger zone (sign out + real account deletion) ──────────────────────────

function DangerZone({ signOut }: { signOut: () => void }) {
  const [confirming, setConfirming] = React.useState(false);
  const [confirmText, setConfirmText] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function deleteAccount() {
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || `Delete failed (${res.status})`);
      }
      // Account data is gone — end the session and leave the app.
      try {
        const { createClient } = await import("@/lib/supabase/client");
        const supabase = createClient();
        if (supabase) await supabase.auth.signOut();
      } catch {
        // non-fatal — the server-side account is already deleted
      }
      window.location.assign("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-4">
      <h3 className="text-sm font-semibold text-destructive">Account</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="gap-1.5" onClick={signOut}>
          <LogOut className="h-3 w-3" /> Sign out
        </Button>
        {!confirming && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirming(true)}
          >
            Delete account
          </Button>
        )}
      </div>
      {confirming && (
        <div className="mt-3 rounded-md border border-destructive/40 bg-background p-3">
          <p className="text-[11px] text-muted-foreground">
            This permanently deletes your account, agents, runs, memories, keys,
            and billing data. It cannot be undone. Type{" "}
            <span className="font-semibold text-destructive">DELETE</span> to confirm.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder="DELETE"
              className="h-8 w-32 text-sm"
            />
            <Button
              size="sm"
              variant="destructive"
              disabled={confirmText !== "DELETE" || deleting}
              onClick={() => void deleteAccount()}
            >
              {deleting ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : <Trash2 className="mr-1.5 h-3 w-3" />}
              Delete forever
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => { setConfirming(false); setConfirmText(""); setError(null); }}
              disabled={deleting}
            >
              Cancel
            </Button>
          </div>
          {error && <p className="mt-2 text-[10px] text-destructive">{error}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Desktop filesystem access ───────────────────────────────────────────────

function DesktopAccessSection() {
  if (!IS_TAURI) {
    return (
      <Section icon={Monitor} title="Desktop">
        <p className="text-[11px] text-muted-foreground">
          Install the Apical desktop app to let agents read and write files on your computer.
        </p>
        <GrantedFoldersManager />
      </Section>
    );
  }

  return (
    <Section icon={Monitor} title="Desktop">
      <div className="rounded-lg border border-border bg-muted p-4">
        <div className="flex items-center gap-2 text-sm font-medium text-foreground">
          <Check className="h-4 w-4 shrink-0 text-foreground" />
          Desktop access enabled
        </div>
        <p className="mt-1.5 text-[11px] text-muted-foreground">
          Agents can read, write, and move files inside the folders you grant below, and run shell commands when you ask them to.
        </p>
      </div>
      <DesktopBackgroundSettings />
      <RemoteAccessSettings />
      <GrantedFoldersManager />
      <WatchedFoldersManager />
      <CloudDeviceLink />
      <LocalOnlyModeSettings />
    </Section>
  );
}

// ─── Desktop background / launch-at-login ────────────────────────────────────

function DesktopBackgroundSettings() {
  const [settings, setSettings] = React.useState<import("@/lib/desktop/desktop-settings").DesktopSettings | null>(null);
  const [autostart, setAutostartState] = React.useState<boolean>(false);

  React.useEffect(() => {
    let alive = true;
    void (async () => {
      const [{ loadDesktopSettings, isAutostartEnabled }] = await Promise.all([
        import("@/lib/desktop/tauri-bridge"),
      ]);
      const s = await loadDesktopSettings();
      const a = await isAutostartEnabled();
      if (alive) {
        setSettings(s);
        setAutostartState(a);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function toggleBackground(v: boolean) {
    if (!settings) return;
    const next = { ...settings, keepRunningInBackground: v };
    setSettings(next);
    const { saveDesktopSettings } = await import("@/lib/desktop/tauri-bridge");
    await saveDesktopSettings(next);
  }

  async function toggleAutostart(v: boolean) {
    setAutostartState(v);
    const { setAutostart, saveDesktopSettings } = await import("@/lib/desktop/tauri-bridge");
    await setAutostart(v);
    // Record the explicit choice so the first-run default never overrides it.
    if (settings && !settings.autostartConfigured) {
      const next = { ...settings, autostartConfigured: true };
      setSettings(next);
      await saveDesktopSettings(next);
    }
  }

  if (!settings) return null;

  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs font-medium text-foreground">Background &amp; startup</p>
      <Toggle
        label="Launch Apical at login"
        desc="Start Apical automatically (hidden in the menu bar) so scheduled workflows keep running."
        checked={autostart}
        onChange={(v) => void toggleAutostart(v)}
      />
      <Toggle
        label="Keep running in background when window closes"
        desc="Closing the window keeps Apical in the menu bar. Turn off to quit fully on close."
        checked={settings.keepRunningInBackground}
        onChange={(v) => void toggleBackground(v)}
      />
    </div>
  );
}

// ─── Remote access policy (default-deny; opt-in from the desktop only) ────────

function RemoteAccessSettings() {
  const [settings, setSettings] = React.useState<import("@/lib/desktop/desktop-settings").DesktopSettings | null>(null);

  React.useEffect(() => {
    let alive = true;
    void import("@/lib/desktop/tauri-bridge")
      .then((m) => m.loadDesktopSettings())
      .then((s) => {
        if (alive) setSettings(s);
      });
    return () => {
      alive = false;
    };
  }, []);

  async function update(patch: Partial<import("@/lib/desktop/desktop-settings").RemoteAccessPolicy>) {
    if (!settings) return;
    const next = { ...settings, remote: { ...settings.remote, ...patch } };
    setSettings(next);
    const { saveDesktopSettings } = await import("@/lib/desktop/tauri-bridge");
    await saveDesktopSettings(next);
    // Re-advertise capabilities to the cloud bridge relay.
    const cloudUrl = process.env.NEXT_PUBLIC_APICAL_CLOUD_URL?.trim() || "https://api.apic.al";
    const { resyncCloudLinkAtBoot } = await import("@/lib/desktop/device-flow");
    await resyncCloudLinkAtBoot(cloudUrl);
  }

  if (!settings) return null;
  const fsMode = settings.remote.fs;

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-4 w-4 shrink-0 text-foreground" />
        <h4 className="text-xs font-semibold">Remote access</h4>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Controls what workflows triggered from the web or on a schedule can do on this computer.
        Off means those runs cannot touch this machine — only workflows you run from this desktop app can.
      </p>

      <div className="mt-3">
        <p className="text-[11px] font-medium text-foreground">Allow cloud workflows to access files</p>
        <div className="mt-1.5 flex gap-1.5">
          {(["off", "read_only", "read_write"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => void update({ fs: mode })}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] transition",
                fsMode === mode
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              {mode === "off" ? "Off" : mode === "read_only" ? "Read only" : "Read & write"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <Toggle
          label="Allow cloud workflows to run commands"
          desc="Lets scheduled/web-triggered runs execute shell commands and scripts on this machine. Only enable if you trust your workflows."
          checked={settings.remote.cli}
          onChange={(v) => void update({ cli: v })}
        />
        <Toggle
          label="Allow cloud workflows to make network requests from this machine"
          desc="Lets runs reach your local network (e.g. internal services). Sensitive — off by default."
          checked={settings.remote.net}
          onChange={(v) => void update({ net: v })}
        />
      </div>
    </div>
  );
}

// ─── Local-only (enterprise, license-gated) ──────────────────────────────────

interface LicenseClaims {
  org: string;
  plan: string;
  seats: number;
  features: string[];
  expiresAt: string;
}

/**
 * Verify a license against the LOCAL bundled server (offline — localhost). We
 * verify server-side because the desktop WebView (Safari 15) may lack WebCrypto
 * Ed25519 support; Node's crypto handles it reliably.
 */
async function verifyLicenseViaLocalServer(
  token: string,
): Promise<{ valid: boolean; reason?: string; claims?: LicenseClaims }> {
  if (!token) return { valid: false, reason: "No license provided." };
  try {
    const res = await fetch("/api/desktop/local/license/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { reason?: string };
      return { valid: false, reason: err.reason ?? `HTTP ${res.status}` };
    }
    return (await res.json()) as { valid: boolean; reason?: string; claims?: LicenseClaims };
  } catch (e) {
    return { valid: false, reason: (e as Error).message };
  }
}

function LocalOnlyModeSettings() {
  const [settings, setSettings] = React.useState<import("@/lib/desktop/desktop-settings").DesktopSettings | null>(null);
  const [licenseInput, setLicenseInput] = React.useState("");
  const [status, setStatus] = React.useState<{ valid: boolean; message: string } | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    void import("@/lib/desktop/tauri-bridge")
      .then((m) => m.loadDesktopSettings())
      .then((s) => {
        if (alive) {
          setSettings(s);
          setLicenseInput(s.license ?? "");
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  async function applyLicense() {
    if (!settings) return;
    setBusy(true);
    setStatus(null);
    try {
      const result = await verifyLicenseViaLocalServer(licenseInput.trim());
      if (!result.valid) {
        setStatus({ valid: false, message: result.reason ?? "Invalid license." });
        // Invalid license → force hybrid.
        const next = { ...settings, license: null, deploymentMode: "hybrid" as const };
        setSettings(next);
        const { saveDesktopSettings } = await import("@/lib/desktop/tauri-bridge");
        await saveDesktopSettings(next);
        return;
      }
      const next = { ...settings, license: licenseInput.trim() };
      setSettings(next);
      const { saveDesktopSettings } = await import("@/lib/desktop/tauri-bridge");
      await saveDesktopSettings(next);
      setStatus({
        valid: true,
        message: `Licensed to ${result.claims?.org ?? "your org"} (expires ${
          result.claims ? new Date(result.claims.expiresAt).toLocaleDateString() : "?"
        }).`,
      });
    } catch (e) {
      setStatus({ valid: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function setMode(mode: "hybrid" | "local_only") {
    if (!settings) return;
    if (mode === "local_only") {
      // Must have a valid license.
      const result = await verifyLicenseViaLocalServer(settings.license ?? "");
      if (!result.valid) {
        setStatus({ valid: false, message: "A valid enterprise license is required for local-only mode." });
        return;
      }
    }
    const next = { ...settings, deploymentMode: mode };
    setSettings(next);
    const { saveDesktopSettings } = await import("@/lib/desktop/tauri-bridge");
    await saveDesktopSettings(next);
  }

  if (!settings) return null;

  return (
    <div className="mt-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-center gap-2">
        <Lock className="h-4 w-4 shrink-0 text-foreground" />
        <h4 className="text-xs font-semibold">Local-only mode (enterprise)</h4>
      </div>
      <p className="mt-1.5 text-[11px] text-muted-foreground">
        Runs Apical fully separated from the web: no cloud bridge, no device link. Requires a valid enterprise license.
        Changes take effect on the next app restart.
      </p>

      <div className="mt-3">
        <Label className="text-[11px]">Enterprise license</Label>
        <div className="mt-1 flex gap-2">
          <Input
            value={licenseInput}
            onChange={(e) => setLicenseInput(e.target.value)}
            placeholder="Paste license token…"
            className="h-8 flex-1 font-mono text-[11px]"
          />
          <Button size="sm" className="h-8 text-xs" disabled={busy || !licenseInput.trim()} onClick={() => void applyLicense()}>
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Apply"}
          </Button>
        </div>
        {status && (
          <p className={cn("mt-1.5 text-[11px]", status.valid ? "text-foreground" : "text-destructive")}>
            {status.message}
          </p>
        )}
      </div>

      <div className="mt-3 flex gap-1.5">
        {(["hybrid", "local_only"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => void setMode(mode)}
            className={cn(
              "rounded-md border px-2.5 py-1 text-[11px] transition",
              settings.deploymentMode === mode
                ? "border-primary bg-primary/10 text-foreground"
                : "border-border text-muted-foreground hover:bg-accent",
            )}
          >
            {mode === "hybrid" ? "Hybrid (cloud-connected)" : "Local-only"}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Granted folder roots (the desktop sandbox) ──────────────────────────────

interface GrantedFolderRow {
  id: string;
  path: string;
  label: string | null;
}

function GrantedFoldersManager() {
  const [folders, setFolders] = React.useState<GrantedFolderRow[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/desktop/folders");
      if (!res.ok) return;
      const data = (await res.json()) as { folders?: GrantedFolderRow[] };
      const list = data.folders ?? [];
      setFolders(list);
      if (IS_TAURI) {
        const { loadDesktopSettings, saveDesktopSettings } = await import("@/lib/desktop/tauri-bridge");
        const s = await loadDesktopSettings();
        await saveDesktopSettings({
          ...s,
          grantedRoots: list.map((f) => f.path),
        });
      }
    } catch {
      /* offline — keep whatever we have */
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function grant() {
    setBusy(true);
    setError(null);
    try {
      let path: string | null = null;
      if (IS_TAURI) {
        const { open } = await import("@tauri-apps/plugin-dialog");
        const picked = await open({ directory: true, multiple: false });
        if (picked) path = String(picked);
      } else {
        path = window.prompt("Absolute folder path to grant (e.g. ~/Documents/Clients):");
      }
      if (path?.trim()) {
        const res = await fetch("/api/desktop/folders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: path.trim() }),
        });
        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `HTTP ${res.status}`);
        }
        await refresh();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await fetch(`/api/desktop/folders/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium text-foreground">Granted folders</p>
        <Button variant="outline" size="sm" className="h-7 text-xs" disabled={busy} onClick={() => void grant()}>
          {busy ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plus className="mr-1 h-3 w-3" />}
          Grant folder
        </Button>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Agents and workflows can only touch files inside these folders. Revoking a folder also disables its watches.
      </p>
      {error && <p className="mt-1.5 text-[11px] text-destructive">{error}</p>}
      {folders.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
          {IS_TAURI
            ? "Filesystem tools use your home folder by default. Grant additional folders here to narrow access for cloud-connected sessions."
            : "No folders granted — filesystem tools are disabled until you grant one."}
        </p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {folders.map((f) => (
            <li key={f.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">{f.path}</span>
              <button
                type="button"
                title="Revoke access"
                className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-destructive"
                onClick={() => void revoke(f.id)}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Watched-folder triggers ──────────────────────────────────────────────────

interface WatchedFolderRow {
  id: string;
  workflowId: string;
  path: string;
  pattern: string | null;
  status: string;
  lastScanAt: string | null;
}

function WatchedFoldersManager() {
  const [watches, setWatches] = React.useState<WatchedFolderRow[]>([]);

  const refresh = React.useCallback(async () => {
    try {
      const res = await fetch("/api/desktop/watches");
      if (!res.ok) return;
      const data = (await res.json()) as { watches?: WatchedFolderRow[] };
      setWatches(data.watches ?? []);
    } catch {
      /* ignore */
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  async function toggle(w: WatchedFolderRow) {
    await fetch(`/api/desktop/watches/${w.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: w.status === "active" ? "paused" : "active" }),
    });
    await refresh();
  }

  async function remove(id: string) {
    await fetch(`/api/desktop/watches/${id}`, { method: "DELETE" });
    await refresh();
  }

  if (watches.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="text-xs font-medium text-foreground">Watched folders</p>
      <p className="mt-1 text-[11px] text-muted-foreground">
        New files in these folders automatically start the linked workflow.
      </p>
      <ul className="mt-2 divide-y divide-border rounded-md border border-border">
        {watches.map((w) => (
          <li key={w.id} className="flex items-center gap-2 px-2.5 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground">
              {w.path}
              {w.pattern ? <span className="text-muted-foreground"> · {w.pattern}</span> : null}
            </span>
            <Badge variant={w.status === "active" ? "default" : "secondary"} className="text-[10px]">
              {w.status}
            </Badge>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition hover:bg-accent hover:text-foreground"
              onClick={() => void toggle(w)}
            >
              {w.status === "active" ? "Pause" : "Resume"}
            </button>
            <button
              type="button"
              title="Delete watch"
              className="rounded p-1 text-muted-foreground transition hover:bg-accent hover:text-destructive"
              onClick={() => void remove(w.id)}
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Cloud device link (device-authorization login) ──────────────────────────

function CloudDeviceLink() {
  const [linked, setLinked] = React.useState<boolean | null>(null);
  const [userCode, setUserCode] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    void import("@/lib/desktop/device-flow")
      .then((m) => m.getStoredDeviceToken())
      .then((t) => setLinked(Boolean(t)))
      .catch(() => setLinked(false));
  }, []);

  async function link() {
    setBusy(true);
    setError(null);
    setUserCode(null);
    try {
      const { linkDesktopToCloud } = await import("@/lib/desktop/device-flow");
      const cloudUrl =
        process.env.NEXT_PUBLIC_APICAL_CLOUD_URL?.trim() || "https://api.apic.al";
      await linkDesktopToCloud(
        cloudUrl,
        {
          label: "Apical Desktop",
          platform: navigator.platform || undefined,
        },
        { onCode: (code) => setUserCode(code) },
      );
      setLinked(true);
      setUserCode(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Linking failed.");
    } finally {
      setBusy(false);
    }
  }

  async function unlink() {
    setBusy(true);
    setError(null);
    try {
      const m = await import("@/lib/desktop/device-flow");
      await m.clearStoredDeviceToken();
      setLinked(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold">Apical cloud account</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Link this desktop to your apic.al account. Sign-in happens in your browser; the
            device token is stored in the OS keychain.
          </p>
        </div>
        {linked === null ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : linked ? (
          <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
            <Check className="h-3 w-3" /> Linked
          </Badge>
        ) : null}
      </div>

      {userCode && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Confirm this code in your browser:{" "}
          <span className="font-mono text-sm font-semibold text-foreground">{userCode}</span>
        </p>
      )}

      {error && (
        <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-3">
        {linked ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={unlink}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Disconnect"}
          </Button>
        ) : (
          <Button size="sm" disabled={busy || linked === null} onClick={link}>
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Link to Apical Cloud"}
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Apical cloud link (desktop / local without provider keys) ───────────────

function CloudApicalLink() {
  const [status, setStatus] = React.useState<{
    configured: boolean;
    prefix: string | null;
    source: "env" | "stored" | null;
    cloudUrl: string;
  } | null>(null);
  const [pat, setPat] = React.useState("");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [expanded, setExpanded] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/cloud-pat");
      if (res.ok) setStatus(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/cloud-pat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pat: pat.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save");
      setStatus(data);
      setPat("");
      setExpanded(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function disconnect() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/cloud-pat", { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to remove");
      setStatus(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove");
    } finally {
      setSaving(false);
    }
  }

  if (!IS_TAURI && !loading && !status?.configured) return null;

  return (
    <div className="mb-4 rounded-lg border border-border bg-muted/20 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold">Apical cloud models</h4>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {IS_TAURI
              ? "Use hosted models from your apic.al account without putting provider keys on this machine."
              : "Link your apic.al API token to call hosted models when no local provider keys are set."}
          </p>
        </div>
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : status?.configured ? (
          <Badge variant="secondary" className="shrink-0 gap-1 text-[10px]">
            <Check className="h-3 w-3" /> Connected
          </Badge>
        ) : null}
      </div>

      {status?.configured && (
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">
          {status.prefix}
          {status.source === "env" ? " (from APICAL_PAT env)" : ""}
          {" · "}
          {status.cloudUrl}
        </p>
      )}

      {error && (
        <div className="mt-2 flex items-center gap-2 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        {!status?.configured || expanded ? (
          <>
            <Input
              type="password"
              value={pat}
              onChange={(e) => setPat(e.target.value)}
              placeholder="ap_pat_… from apic.al → Settings → API tokens"
              className="h-8 flex-1 min-w-[200px] font-mono text-xs"
              autoComplete="off"
            />
            <Button size="sm" disabled={saving || !pat.trim()} onClick={() => void save()}>
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : "Connect"}
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" onClick={() => setExpanded(true)}>
              Replace token
            </Button>
            {status.source !== "env" && (
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => void disconnect()}>
                Disconnect
              </Button>
            )}
          </>
        )}
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
    // Persisted server-side for both custom rows (CustomModel.enabled) and
    // built-in registry models (UserModelPref). Optimistic flip, then reload.
    const next = model.enabled === false;
    setModels((prev) =>
      prev.map((m) => (m.id === model.id ? { ...m, enabled: next } : m)),
    );
    try {
      const res = await fetch(
        `/api/llm/models/${encodeURIComponent(model.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enabled: next }),
        },
      );
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
      void load();
    } catch (err) {
      console.error("[settings] toggle failed:", err);
      void load(); // roll back the optimistic flip
    }
  }

  async function setDefault(model: ModelEntry) {
    try {
      const res = await fetch(
        `/api/llm/models/${encodeURIComponent(model.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ isDefault: true }),
        },
      );
      if (!res.ok) throw new Error(`PATCH failed (${res.status})`);
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
        AI models your agents can use. Hosted models are billed per token — either via your linked Apical account (desktop) or local provider keys. Toggle models on/off to control which appear in the agent picker.
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
      ? "border-border text-foreground"
      : model.tier === "byok"
        ? "border-amber-500/30 text-amber-600"
        : "border-border text-foreground";

  return (
    <div className="group flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 hover:border-border/80">
      <div className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-md", enabled ? "bg-accent text-foreground" : "bg-muted text-muted-foreground")}>
        <Cpu className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-xs font-medium">{model.name}</span>
          {model.isDefault && (
            <Badge variant="outline" className="border-border text-[9px] text-foreground">
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
      {!model.isDefault && enabled && (
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

// ─── Admin: token limits ────────────────────────────────────────────────────

type TokenLimitsPayload = {
  config: {
    globalMultiplier: number;
    planAllowances: Partial<Record<string, number>>;
  };
  catalog: Record<string, number>;
  effectiveByPlan: Record<string, number>;
};

function AdminTokenLimitsSection() {
  const [visible, setVisible] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState(false);
  const [data, setData] = React.useState<TokenLimitsPayload | null>(null);
  const [multiplier, setMultiplier] = React.useState("1");
  const [planOverrides, setPlanOverrides] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/token-limits");
        if (res.status === 403) {
          if (!cancelled) setVisible(false);
          return;
        }
        if (!res.ok) throw new Error("Failed to load token limits");
        const json = (await res.json()) as TokenLimitsPayload;
        if (cancelled) return;
        setVisible(true);
        setData(json);
        setMultiplier(String(json.config.globalMultiplier ?? 1));
        setPlanOverrides(
          Object.fromEntries(
            Object.entries(json.config.planAllowances ?? {}).map(([k, v]) => [k, String(v)]),
          ),
        );
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  const plans = [
    { id: "free", label: "Free" },
    { id: "personal", label: "Personal" },
    { id: "team", label: "Team" },
    { id: "enterprise", label: "Enterprise" },
  ];

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const globalMultiplier = Number(multiplier);
      if (!Number.isFinite(globalMultiplier) || globalMultiplier <= 0) {
        throw new Error("Multiplier must be a positive number");
      }
      const planAllowances: Record<string, number | null> = {};
      for (const p of plans) {
        const raw = planOverrides[p.id]?.trim();
        if (!raw) {
          planAllowances[p.id] = null;
          continue;
        }
        const n = Number(raw.replace(/,/g, ""));
        if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid limit for ${p.label}`);
        planAllowances[p.id] = Math.round(n);
      }
      const res = await fetch("/api/admin/token-limits", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ globalMultiplier, planAllowances }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Save failed");
      }
      const json = (await res.json()) as TokenLimitsPayload;
      setData(json);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section icon={SlidersHorizontal} title="Admin · Token limits">
      <p className="mb-3 text-[11px] text-muted-foreground">
        Platform-wide monthly token allowances. Plan catalog values are multiplied unless you set a per-plan override (0 = unlimited).
      </p>
      {loading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Global multiplier</Label>
            <Input
              value={multiplier}
              onChange={(e) => setMultiplier(e.target.value)}
              className="h-9 max-w-[140px] text-sm tabular-nums"
              inputMode="decimal"
            />
            <p className="text-[10px] text-muted-foreground">
              Applied to each plan&apos;s catalog allowance when no override is set.
            </p>
          </div>
          <div className="space-y-2">
            {plans.map((p) => (
              <div key={p.id} className="grid gap-1.5 sm:grid-cols-[120px_1fr_auto] sm:items-center">
                <Label className="text-xs">{p.label}</Label>
                <Input
                  value={planOverrides[p.id] ?? ""}
                  onChange={(e) =>
                    setPlanOverrides((prev) => ({ ...prev, [p.id]: e.target.value }))
                  }
                  placeholder={
                    data?.catalog[p.id]
                      ? `Default ${data.catalog[p.id].toLocaleString()} × multiplier`
                      : "Override (optional)"
                  }
                  className="h-8 text-sm tabular-nums"
                />
                <span className="text-[10px] text-muted-foreground sm:text-right">
                  Effective:{" "}
                  {(data?.effectiveByPlan[p.id] ?? 0) <= 0
                    ? "Unlimited"
                    : (data?.effectiveByPlan[p.id] ?? 0).toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          {error && (
            <div className="flex items-center gap-1.5 text-[11px] text-destructive">
              <AlertCircle className="h-3.5 w-3.5" /> {error}
            </div>
          )}
          {saved && (
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-600">
              <Check className="h-3.5 w-3.5" /> Saved
            </div>
          )}
          <Button size="sm" onClick={save} disabled={saving} className="gap-1.5">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save token limits
          </Button>
        </div>
      )}
    </Section>
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
