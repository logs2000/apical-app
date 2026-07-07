"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Check, Sparkles, ExternalLink } from "lucide-react";

// Real billing data. GET /api/billing/subscription + /api/billing/plans feed
// the view; POST /api/billing/checkout and /api/billing/portal drive changes.
// No hardcoded numbers — everything on screen comes from the server.

interface PlanDef {
  id: string;
  name: string;
  tagline: string;
  priceMonthly: number;
  priceYearly: number;
  tokenAllowanceMonthly: number;
  featured: boolean;
  features: string[];
}

interface BillingStatusRes {
  subscription: { plan: string; status: string; currentPeriodEnd: string; overrunEnabled: boolean };
  plan: PlanDef;
  usage: { used: number; allowance: number; overage: number; periodEnd: string };
  overrunAvailable: boolean;
  demoMode: boolean;
}

export function BillingTab() {
  const [interval, setInterval] = React.useState<"monthly" | "yearly">("monthly");
  const [status, setStatus] = React.useState<BillingStatusRes | null>(null);
  const [plans, setPlans] = React.useState<PlanDef[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null); // planId or 'portal'

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subRes, plansRes] = await Promise.all([
        fetch("/api/billing/subscription"),
        fetch("/api/billing/plans"),
      ]);
      if (!subRes.ok || !plansRes.ok) throw new Error("Could not load billing status.");
      const sub = (await subRes.json()) as BillingStatusRes;
      const planData = (await plansRes.json()) as { plans: PlanDef[] };
      setStatus(sub);
      setPlans(planData.plans);
    } catch (e) {
      setError((e as Error).message || "Could not load billing status.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const checkout = async (planId: string) => {
    setBusy(planId);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, interval }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Checkout failed.");
      window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const openPortal = async () => {
    setBusy("portal");
    setError(null);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      const data = (await res.json()) as { url?: string; error?: string };
      if (!res.ok || !data.url) throw new Error(data.error || "Could not open the billing portal.");
      window.location.href = data.url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };

  const currentPlanId = status?.subscription.plan ?? "free";
  const usagePct =
    status && status.usage.allowance > 0
      ? Math.min(100, (status.usage.used / status.usage.allowance) * 100)
      : 0;
  const periodEnd = status ? new Date(status.usage.periodEnd) : null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <CreditCard className="h-4 w-4 text-muted-foreground" /> Billing
          {status?.demoMode && (
            <Badge variant="outline" className="border-border bg-muted text-[10px] text-muted-foreground">
              Demo billing — no card will be charged
            </Badge>
          )}
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Manage your plan, usage, and payment method.</p>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
          {error}{" "}
          <button className="underline" onClick={() => void load()}>
            Retry
          </button>
        </div>
      )}

      {loading ? (
        <div className="rounded-lg border border-border bg-card p-6 text-center text-xs text-muted-foreground">
          Loading billing…
        </div>
      ) : status ? (
        <>
          {/* Current plan + usage */}
          <div className="mb-5 rounded-lg border border-border bg-gradient-to-br from-primary/10 via-card to-card p-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Current plan</div>
                <div className="mt-0.5 flex items-center gap-2">
                  <span className="text-lg font-semibold">{status.plan.name}</span>
                  <Badge variant="outline" className="border-border bg-muted capitalize text-foreground">
                    {status.subscription.status}
                  </Badge>
                </div>
              </div>
              <Button size="sm" variant="outline" className="gap-1.5" disabled={busy !== null} onClick={() => void openPortal()}>
                <CreditCard className="h-3 w-3" /> {busy === "portal" ? "Opening…" : "Manage"}
              </Button>
            </div>
            <div className="mt-4">
              <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Tokens this period</div>
              <div className="mt-1 text-sm font-semibold tabular-nums">
                {status.usage.used.toLocaleString()}
                {status.usage.allowance > 0 && (
                  <span className="text-muted-foreground"> / {status.usage.allowance.toLocaleString()}</span>
                )}
              </div>
              {status.usage.allowance > 0 && (
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full bg-primary" style={{ width: `${usagePct}%` }} />
                </div>
              )}
              <div className="mt-1.5 text-[10px] text-muted-foreground">
                {status.usage.overage > 0
                  ? `${status.usage.overage.toLocaleString()} tokens over allowance${status.subscription.overrunEnabled ? " (overrun billing on)" : ""}`
                  : periodEnd
                    ? `Resets ${periodEnd.toLocaleDateString()}`
                    : null}
              </div>
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

          {/* Plans */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {plans.map((p) => {
              const isCurrent = p.id === currentPlanId;
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
                    <span className="text-xs text-muted-foreground">/mo</span>
                  </div>
                  <div className="mt-1 min-h-[1rem] text-[10px] text-muted-foreground">
                    {interval === "yearly" && p.priceYearly > 0 ? `$${p.priceYearly}/yr` : " "}
                  </div>
                  <Button
                    variant={p.featured ? "default" : "outline"}
                    size="sm"
                    className="mt-3 w-full"
                    disabled={isCurrent || p.priceMonthly === 0 || busy !== null}
                    onClick={() => void checkout(p.id)}
                  >
                    {isCurrent ? "Current plan" : p.priceMonthly === 0 ? "Included" : busy === p.id ? "Redirecting…" : "Upgrade"}
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

          {/* Invoices — they live in the Stripe billing portal; no fake table. */}
          <div className="mt-6">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Invoices</h3>
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <p className="text-[11px] text-muted-foreground">
                {currentPlanId === "free"
                  ? "No invoices — you're on the Free plan."
                  : "Invoices and receipts are available in the billing portal."}
              </p>
              {currentPlanId !== "free" && (
                <Button size="sm" variant="ghost" className="gap-1.5 text-[11px]" disabled={busy !== null} onClick={() => void openPortal()}>
                  <ExternalLink className="h-3 w-3" /> Open portal
                </Button>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
