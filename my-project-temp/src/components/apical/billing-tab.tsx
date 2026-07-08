"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useBillingPlans,
  useBillingStatus,
  useUsage,
  useWorkflows,
} from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import {
  CreditCard,
  Check,
  Sparkles,
  Download,
  TrendingUp,
  Loader2,
  AlertCircle,
} from "lucide-react";

const PAID_PLAN_IDS = new Set(["personal", "team", "enterprise"]);

export function BillingTab() {
  const [interval, setInterval] = React.useState<"monthly" | "yearly">("monthly");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const qc = useQueryClient();

  const { data: plansData, isLoading: plansLoading } = useBillingPlans();
  const { data: status, isLoading: statusLoading } = useBillingStatus();
  const { data: usage } = useUsage();
  const { data: workflows } = useWorkflows();

  const currentPlan = status?.subscription.plan ?? plansData?.current.plan ?? "free";
  const loading = plansLoading || statusLoading;

  async function upgrade(planId: string) {
    if (!PAID_PLAN_IDS.has(planId)) return;
    setBusy(planId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId, interval }),
      });
      const data = (await res.json()) as { url?: string; error?: string; demoMode?: boolean };
      if (!res.ok || !data.url) throw new Error(data.error || `Checkout failed (${res.status})`);
      if (data.demoMode) {
        // Demo mode upgraded the subscription immediately — refresh in place.
        await qc.invalidateQueries({ queryKey: ["billing"] });
        await qc.invalidateQueries({ queryKey: ["usage"] });
      } else {
        window.location.assign(data.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Checkout failed");
    } finally {
      setBusy(null);
    }
  }

  async function openPortal() {
    setBusy("portal");
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string; demoMode?: boolean };
      if (!res.ok || !data.url) throw new Error(data.error || `Portal failed (${res.status})`);
      if (data.demoMode) {
        setError("Billing portal isn't available in demo mode.");
      } else {
        window.location.assign(data.url);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not open billing portal");
    } finally {
      setBusy(null);
    }
  }

  function downloadUsageCsv() {
    if (!usage) return;
    const lines = [
      "date,tokens,cost_cents",
      ...usage.byDay.map((d) => `${d.date},${d.tokens},${d.costCents}`),
      "",
      "model,provider,total_tokens,cost_cents,calls",
      ...usage.byModel.map(
        (m) => `${m.modelId},${m.provider},${m.totalTokens},${m.costCents},${m.calls}`,
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apical-usage-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const tokensUsed = status?.usage.used ?? 0;
  const tokenAllowance = status?.usage.allowance ?? 0;
  const agentCount = workflows?.length ?? 0;
  const maxAgents = status?.plan.maxAgents ?? 0;
  const modelCalls = usage?.byModel.reduce((a, m) => a + m.calls, 0) ?? 0;
  const periodEnd = status?.usage.periodEnd
    ? new Date(status.usage.periodEnd).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      })
    : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <CreditCard className="h-4 w-4 text-muted-foreground" /> Billing
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Manage your plan, usage, and payment method.</p>
      </div>

      {error && (
        <div className="mb-3 flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {/* Current plan + usage */}
      <div className="mb-5 rounded-lg border border-border bg-gradient-to-br from-primary/10 via-card to-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Current plan</div>
            <div className="mt-0.5 flex items-center gap-2">
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <>
                  <span className="text-lg font-semibold capitalize">{currentPlan}</span>
                  {currentPlan === "free" ? (
                    <Badge variant="outline" className="border-border bg-muted text-foreground">Free forever</Badge>
                  ) : periodEnd ? (
                    <Badge variant="outline" className="border-border bg-muted text-foreground">
                      Renews {periodEnd}
                    </Badge>
                  ) : null}
                </>
              )}
            </div>
          </div>
          {status?.subscription.stripeCustomerId && !status.demoMode && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => void openPortal()}
              disabled={busy === "portal"}
            >
              {busy === "portal" ? <Loader2 className="h-3 w-3 animate-spin" /> : <CreditCard className="h-3 w-3" />}{" "}
              Manage
            </Button>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <UsageStat
            label="Tokens this period"
            current={tokensUsed}
            max={tokenAllowance > 0 ? tokenAllowance : null}
          />
          <UsageStat label="Agents" current={agentCount} max={maxAgents > 0 ? maxAgents : null} />
          <UsageStat label="Model calls" current={modelCalls} max={null} />
        </div>
      </div>

      {/* Interval toggle */}
      <div className="mb-3 flex items-center justify-center">
        <div className="inline-flex items-center rounded-full border border-border bg-muted/40 p-0.5 text-xs">
          <button
            onClick={() => setInterval("monthly")}
            className={cn("rounded-full px-4 py-1.5 font-medium transition-colors", interval === "monthly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
          >
            Monthly
          </button>
          <button
            onClick={() => setInterval("yearly")}
            className={cn("inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 font-medium transition-colors", interval === "yearly" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
          >
            Yearly
            <span className="rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-semibold uppercase text-foreground">2 mo free</span>
          </button>
        </div>
      </div>

      {/* Plans (excluding enterprise — it gets the contact-sales CTA below) */}
      <div className="grid gap-3 sm:grid-cols-3">
        {(plansData?.plans ?? [])
          .filter((p) => p.id !== "enterprise")
          .map((p) => {
            const isCurrent = p.id === currentPlan;
            const price = interval === "monthly" ? p.priceMonthly : Math.round(p.priceYearly / 12);
            return (
              <div
                key={p.id}
                className={cn(
                  "relative flex flex-col rounded-xl border bg-card p-4",
                  p.featured ? "border-foreground/20 shadow-md" : "border-border",
                )}
              >
                {p.featured && (
                  <Badge className="absolute -top-2 left-4 gap-1 bg-primary text-primary-foreground">
                    <Sparkles className="h-3 w-3" /> Most popular
                  </Badge>
                )}
                <h3 className="text-sm font-semibold">{p.name}</h3>
                <p className="mt-0.5 min-h-[2rem] text-[11px] leading-relaxed text-muted-foreground">{p.tagline}</p>
                <div className="mt-3 flex items-baseline gap-1">
                  <span className="text-2xl font-semibold tracking-tight">${price}</span>
                  <span className="text-xs text-muted-foreground">
                    /mo{p.id === "team" ? " per seat" : ""}
                  </span>
                </div>
                <div className="mt-1 min-h-[1rem] text-[10px] text-muted-foreground">
                  {interval === "yearly" && p.priceYearly > 0 ? `$${p.priceYearly}/yr` : " "}
                </div>
                <Button
                  variant={p.featured ? "default" : "outline"}
                  size="sm"
                  className="mt-3 w-full"
                  disabled={isCurrent || busy !== null || !PAID_PLAN_IDS.has(p.id)}
                  onClick={() => void upgrade(p.id)}
                >
                  {busy === p.id ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : isCurrent ? (
                    "Current plan"
                  ) : PAID_PLAN_IDS.has(p.id) ? (
                    "Upgrade"
                  ) : (
                    "Included"
                  )}
                </Button>
                <ul className="mt-4 space-y-1.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex items-start gap-1.5 text-[11px]">
                      <span className="mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full bg-accent text-foreground">
                        <Check className="h-2 w-2" />
                      </span>
                      <span className="text-foreground/80">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
      </div>

      {/* Usage by model */}
      {usage && usage.byModel.length > 0 && (
        <div className="mt-6">
          <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Usage by model (this period)
          </h3>
          <div className="overflow-hidden rounded-lg border border-border bg-card">
            {usage.byModel.map((m, i) => (
              <div
                key={m.modelId}
                className={cn(
                  "flex items-center justify-between gap-3 p-2.5 text-[11px]",
                  i > 0 && "border-t border-border",
                )}
              >
                <div className="min-w-0">
                  <span className="font-medium">{m.modelId}</span>
                  <span className="ml-1.5 text-muted-foreground">{m.provider}</span>
                </div>
                <div className="shrink-0 text-right tabular-nums text-muted-foreground">
                  {m.totalTokens.toLocaleString()} tokens · {m.calls} calls
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Enterprise CTA */}
      <div className="mt-6 flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <div>
          <h3 className="text-sm font-semibold">Enterprise</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Self-host, SSO, custom DPA, volume pricing.</p>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 shrink-0"
          onClick={() => window.open("mailto:hello@apic.al?subject=Apical%20Enterprise", "_blank")}
        >
          <TrendingUp className="h-3 w-3" /> Contact sales
        </Button>
      </div>

      <div className="mt-4 flex justify-center">
        <Button
          size="sm"
          variant="ghost"
          className="gap-1.5 text-[11px] text-muted-foreground"
          onClick={downloadUsageCsv}
          disabled={!usage}
        >
          <Download className="h-3 w-3" /> Download usage report (CSV)
        </Button>
      </div>
    </div>
  );
}

function UsageStat({ label, current, max }: { label: string; current: number; max: number | null }) {
  const pct = max ? Math.min(100, (current / max) * 100) : 0;
  return (
    <div>
      <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-semibold tabular-nums">
        {current.toLocaleString()}{max !== null && <span className="text-muted-foreground"> / {max.toLocaleString()}</span>}
      </div>
      {max !== null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
