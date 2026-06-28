"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, Check, Sparkles, Download, TrendingUp } from "lucide-react";

export function BillingTab() {
  const [interval, setInterval] = React.useState<"monthly" | "yearly">("monthly");
  const currentPlan = "free";

  const plans = [
    { id: "free", name: "Free", price: 0, yearly: 0, tagline: "For trying it out and small jobs.", features: ["1 agent running at a time", "50 tasks / month", "Local-only model keys", "Community support"] },
    { id: "pro", name: "Pro", price: 19, yearly: 190, tagline: "For people who actually want work done.", featured: true, features: ["5 agents running at once", "Unlimited tasks", "Bring-your-own model keys", "Scheduled + recurring runs", "Email support"] },
    { id: "team", name: "Team", price: 49, yearly: 490, tagline: "For a small group handing off together.", features: ["Everything in Pro", "5 seats included", "Shared folders + agents", "Audit log export", "Priority support"] },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
      <div className="mb-4">
        <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
          <CreditCard className="h-4 w-4 text-muted-foreground" /> Billing
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Manage your plan, usage, and payment method.</p>
      </div>

      {/* Current plan + usage */}
      <div className="mb-5 rounded-lg border border-border bg-gradient-to-br from-primary/10 via-card to-card p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Current plan</div>
            <div className="mt-0.5 flex items-center gap-2">
              <span className="text-lg font-semibold capitalize">{currentPlan}</span>
              <Badge variant="outline" className="border-border bg-muted text-foreground">Free forever</Badge>
            </div>
          </div>
          <Button size="sm" variant="outline" className="gap-1.5">
            <CreditCard className="h-3 w-3" /> Manage
          </Button>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <UsageStat label="Tasks this month" current={42} max={50} />
          <UsageStat label="Agents" current={1} max={1} />
          <UsageStat label="Model calls" current={1240} max={null} />
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
      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p) => {
          const isCurrent = p.id === currentPlan;
          const price = interval === "monthly" ? p.price : Math.round(p.yearly / 12);
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
                {interval === "yearly" && p.yearly > 0 ? `$${p.yearly}/yr` : "\u00A0"}
              </div>
              <Button
                variant={p.featured ? "default" : "outline"}
                size="sm"
                className="mt-3 w-full"
                disabled={isCurrent}
              >
                {isCurrent ? "Current plan" : "Upgrade"}
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

      {/* Invoices */}
      <div className="mt-6">
        <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Invoices</h3>
        <div className="rounded-lg border border-border bg-card">
          <div className="border-b border-border p-3 text-center text-[11px] text-muted-foreground">
            No invoices yet — you&apos;re on the Free plan.
          </div>
        </div>
      </div>

      {/* Enterprise CTA */}
      <div className="mt-6 flex items-start justify-between gap-3 rounded-lg border border-border bg-muted/30 p-4">
        <div>
          <h3 className="text-sm font-semibold">Enterprise</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">Self-host, SSO, custom DPA, volume pricing.</p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 shrink-0">
          <TrendingUp className="h-3 w-3" /> Contact sales
        </Button>
      </div>

      <div className="mt-4 flex justify-center">
        <Button size="sm" variant="ghost" className="gap-1.5 text-[11px] text-muted-foreground">
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
        {current.toLocaleString()}{max !== null && <span className="text-muted-foreground"> / {max}</span>}
      </div>
      {max !== null && (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}
