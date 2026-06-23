"use client";

import * as React from "react";
import { motion } from "framer-motion";
import { useAppStore } from "@/lib/apical/store";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  LayoutTemplate,
  Search,
  Check,
  Plus,
  FileStack,
  Wallet,
  Users,
  CalendarClock,
  Code2,
  Sparkles,
  ArrowRight,
} from "lucide-react";

// ─── Categories ──────────────────────────────────────────────────────────────

type Category = "Filing" | "Finance" | "Client" | "Dispatch" | "Development";

const CATEGORY_META: Record<
  Category,
  { color: string; badge: string; icon: React.ComponentType<{ className?: string }> }
> = {
  Filing: {
    color: "var(--primary)",
    badge: "bg-primary/10 text-primary border-primary/30",
    icon: FileStack,
  },
  Finance: {
    color: "var(--hardened)",
    badge: "bg-hardened/15 text-hardened border-hardened/30",
    icon: Wallet,
  },
  Client: {
    color: "var(--reason)",
    badge: "bg-reason/15 text-reason border-reason/30",
    icon: Users,
  },
  Dispatch: {
    color: "var(--gate)",
    badge: "bg-gate/15 text-gate-foreground border-gate/30",
    icon: CalendarClock,
  },
  Development: {
    color: "oklch(0.5 0.12 270)",
    badge: "bg-indigo-500/10 text-indigo-600 border-indigo-500/30",
    icon: Code2,
  },
};

// ─── Template model + demo data ──────────────────────────────────────────────

export interface Template {
  id: string;
  name: string;
  category: Category;
  description: string;
  steps: { label: string; kind: "tool" | "reason" | "gate" | "spawn" }[];
  schedule: string;
  popularity: number; // installs count, for "popular" sort
}

const TEMPLATES: Template[] = [
  {
    id: "tpl-scan-pdf",
    name: "Sort scanner PDFs by client",
    category: "Filing",
    description:
      "Watch /Scan Inbox, OCR each PDF, identify the client, and file into the right folder. Asks before creating a new client folder.",
    steps: [
      { label: "List /Scan Inbox", kind: "tool" },
      { label: "OCR + identify client", kind: "reason" },
      { label: "Confirm new clients", kind: "gate" },
      { label: "Move to /Clients/{{client}}/", kind: "tool" },
    ],
    schedule: "every 15 min",
    popularity: 1840,
  },
  {
    id: "tpl-chase-invoices",
    name: "Chase overdue invoices",
    category: "Finance",
    description:
      "Daily check of unpaid invoices. Polite reminder at 7 days late, escalation draft at 30 days for you to approve.",
    steps: [
      { label: "Pull unpaid invoices", kind: "tool" },
      { label: "Bucket by days overdue", kind: "reason" },
      { label: "Approve escalations", kind: "gate" },
      { label: "Send reminders", kind: "tool" },
    ],
    schedule: "daily 9am",
    popularity: 1320,
  },
  {
    id: "tpl-weekly-updates",
    name: "Draft weekly client updates",
    category: "Client",
    description:
      "Every Monday morning, draft a short summary email to each client about last week's work. You approve before send.",
    steps: [
      { label: "Pull last week's activity", kind: "tool" },
      { label: "Draft per-client summary", kind: "reason" },
      { label: "Approve drafts", kind: "gate" },
      { label: "Schedule in Gmail", kind: "tool" },
    ],
    schedule: "weekly Mon 8am",
    popularity: 980,
  },
  {
    id: "tpl-competitor-watch",
    name: "Competitor price watch",
    category: "Dispatch",
    description:
      "Fetch competitor pricing pages every 6h, diff against yesterday's snapshot, and ping #competitors when anything changes.",
    steps: [
      { label: "Fetch competitor pages", kind: "tool" },
      { label: "Diff vs last snapshot", kind: "reason" },
      { label: "Slack #competitors", kind: "tool" },
    ],
    schedule: "every 6h",
    popularity: 760,
  },
  {
    id: "tpl-audit-expenses",
    name: "Audit expense reports",
    category: "Finance",
    description:
      "Pull new expense reports, check each line against your policy. Flag anything over $500 or missing a receipt; auto-approve the rest.",
    steps: [
      { label: "Pull new reports", kind: "tool" },
      { label: "Check line items vs policy", kind: "reason" },
      { label: "Approve flagged items", kind: "gate" },
      { label: "Auto-approve the rest", kind: "tool" },
    ],
    schedule: "manual",
    popularity: 1120,
  },
  {
    id: "tpl-onboarding-seq",
    name: "Onboarding email sequence",
    category: "Client",
    description:
      "When someone signs up, draft a 3-email onboarding sequence (welcome, day-3, day-7) personalized from CRM data. You approve before send.",
    steps: [
      { label: "Pull new signups", kind: "tool" },
      { label: "Draft 3-email sequence", kind: "reason" },
      { label: "Approve drafts", kind: "gate" },
      { label: "Schedule in Gmail", kind: "tool" },
    ],
    schedule: "daily 9am",
    popularity: 640,
  },
  {
    id: "tpl-ssl-renew",
    name: "Renew SSL certs before expiry",
    category: "Dispatch",
    description:
      "Scan your cert store daily. For anything expiring in 14 days, file a renewal task and ping #ops. Auto-renews Let's Encrypt certs.",
    steps: [
      { label: "Scan cert store", kind: "tool" },
      { label: "Flag expiries <14d", kind: "reason" },
      { label: "Approve manual renewals", kind: "gate" },
      { label: "Auto-renew Let's Encrypt", kind: "tool" },
    ],
    schedule: "daily 8am",
    popularity: 410,
  },
  {
    id: "tpl-sales-prospects",
    name: "Find sales prospects",
    category: "Client",
    description:
      "Weekly: search LinkedIn for companies matching your ICP, enrich with Clearbit, and queue the list for your review before CRM add.",
    steps: [
      { label: "Search LinkedIn for ICP", kind: "reason" },
      { label: "Enrich with Clearbit", kind: "tool" },
      { label: "Review list", kind: "gate" },
      { label: "Add to HubSpot", kind: "tool" },
    ],
    schedule: "weekly Mon",
    popularity: 520,
  },
  {
    id: "tpl-security-advisory",
    name: "Security advisory monitor",
    category: "Development",
    description:
      "Watch GitHub Security Advisories + NVD for your dependencies. Open a Linear ticket for any high/critical CVE affecting your repos.",
    steps: [
      { label: "Fetch advisory feed", kind: "tool" },
      { label: "Match against deps", kind: "reason" },
      { label: "Triage high/critical", kind: "gate" },
      { label: "Open Linear ticket", kind: "tool" },
    ],
    schedule: "every 2h",
    popularity: 380,
  },
  {
    id: "tpl-inbox-triage",
    name: "Daily inbox triage",
    category: "Filing",
    description:
      "Each morning, categorize your inbox (billing/internal/newsletter/client), draft replies to internal email, and surface what needs a real response.",
    steps: [
      { label: "Pull inbox since 6am", kind: "tool" },
      { label: "Categorize each thread", kind: "reason" },
      { label: "Approve draft replies", kind: "gate" },
      { label: "File newsletters", kind: "tool" },
    ],
    schedule: "daily 9am",
    popularity: 1560,
  },
  {
    id: "tpl-license-tracker",
    name: "License expiry tracker",
    category: "Dispatch",
    description:
      "Scan calendar + contracts DB daily. Anything expiring in 30 days gets a renewal task with the vendor contact + cost pre-filled.",
    steps: [
      { label: "Scan calendar + contracts", kind: "tool" },
      { label: "Flag expiries <30d", kind: "reason" },
      { label: "Create renewal tasks", kind: "tool" },
    ],
    schedule: "daily 8am",
    popularity: 290,
  },
  {
    id: "tpl-weekly-issues",
    name: "Weekly issue summary",
    category: "Development",
    description:
      "Every Friday: pull closed issues from Linear, group by label/owner, draft a recap post for #eng with wins + carryover. You approve before post.",
    steps: [
      { label: "Pull closed issues", kind: "tool" },
      { label: "Group + summarize", kind: "reason" },
      { label: "Approve recap", kind: "gate" },
      { label: "Post to Slack #eng", kind: "tool" },
    ],
    schedule: "weekly Fri",
    popularity: 240,
  },
];

const CATEGORIES: ("All" | Category)[] = [
  "All",
  "Filing",
  "Finance",
  "Client",
  "Dispatch",
  "Development",
];

const KIND_COLOR: Record<string, string> = {
  tool: "bg-tool text-tool-foreground",
  reason: "bg-reason/15 text-reason",
  gate: "bg-gate/20 text-gate-foreground",
  spawn: "bg-reason/15 text-reason",
};

// ─── Templates view ──────────────────────────────────────────────────────────

export function TemplatesView() {
  const [query, setQuery] = React.useState("");
  const [activeCat, setActiveCat] = React.useState<"All" | Category>("All");
  const installed = useAppStore((s) => s.installedTemplates);
  const installTemplate = useAppStore((s) => s.installTemplate);
  const uninstallTemplate = useAppStore((s) => s.uninstallTemplate);
  const setMode = useAppStore((s) => s.setMode);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return TEMPLATES.filter((t) => {
      if (activeCat !== "All" && t.category !== activeCat) return false;
      if (!q) return true;
      return (
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        t.category.toLowerCase().includes(q)
      );
    }).sort((a, b) => b.popularity - a.popularity);
  }, [query, activeCat]);

  const installedCount = installed.length;

  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain">
      <div className="mx-auto max-w-5xl px-4 py-5 md:px-6">
        {/* Header */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight">
              <LayoutTemplate className="h-4 w-4 text-muted-foreground" /> Templates
            </h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Pre-built workflows you can install with one click. Each one becomes a new
              agent in your account, ready to customize.
            </p>
          </div>
          {installedCount > 0 && (
            <Badge
              variant="outline"
              className="gap-1 border-primary/30 bg-primary/5 text-primary"
            >
              <Check className="h-3 w-3" /> {installedCount} installed
            </Badge>
          )}
        </div>

        {/* Search + filter pills */}
        <div className="mb-4 space-y-2.5">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search templates…"
              className="h-9 pl-8 text-sm"
            />
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {CATEGORIES.map((cat) => {
              const active = activeCat === cat;
              const meta = cat !== "All" ? CATEGORY_META[cat] : null;
              const Icon = cat === "All" ? Sparkles : meta?.icon;
              return (
                <button
                  key={cat}
                  onClick={() => setActiveCat(cat)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors",
                    active
                      ? "border-foreground/20 bg-foreground text-background"
                      : "border-border bg-background text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {Icon && <Icon className="h-3 w-3" />}
                  {cat}
                  {cat !== "All" && (
                    <span className="text-[9px] opacity-60">
                      {TEMPLATES.filter((t) => t.category === cat).length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Grid */}
        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-10 text-center">
            <LayoutTemplate className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No templates match &ldquo;{query}&rdquo;</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Try a different search or clear the category filter.
            </p>
            <Button
              size="sm"
              variant="ghost"
              className="mt-3"
              onClick={() => {
                setQuery("");
                setActiveCat("All");
              }}
            >
              Reset filters
            </Button>
          </div>
        ) : (
          <motion.div
            className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
            initial="hidden"
            animate="show"
            variants={{
              hidden: {},
              show: { transition: { staggerChildren: 0.04 } },
            }}
          >
            {filtered.map((tpl) => {
              const isInstalled = installed.some((x) => x.id === tpl.id);
              const meta = CATEGORY_META[tpl.category];
              return (
                <motion.div
                  key={tpl.id}
                  variants={{
                    hidden: { opacity: 0, y: 8 },
                    show: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.22, ease: "easeOut" }}
                >
                  <TemplateCard
                    template={tpl}
                    installed={isInstalled}
                    onInstall={() =>
                      installTemplate({
                        id: tpl.id,
                        name: tpl.name,
                        category: tpl.category,
                        installedAt: new Date().toISOString(),
                      })
                    }
                    onUninstall={() => uninstallTemplate(tpl.id)}
                    onViewAgents={() => setMode("agents")}
                  />
                </motion.div>
              );
            })}
          </motion.div>
        )}

        {/* Footer hint */}
        <div className="mt-6 flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
          <Sparkles className="h-3 w-3" />
          <span>
            {TEMPLATES.length} templates across {CATEGORIES.length - 1} categories · installs
            are local to this demo
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Template card ───────────────────────────────────────────────────────────

function TemplateCard({
  template,
  installed,
  onInstall,
  onUninstall,
  onViewAgents,
}: {
  template: Template;
  installed: boolean;
  onInstall: () => void;
  onUninstall: () => void;
  onViewAgents: () => void;
}) {
  const meta = CATEGORY_META[template.category];
  const CatIcon = meta.icon;
  return (
    <div
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-xl border bg-card p-4 transition-all",
        installed
          ? "border-primary/40 shadow-sm"
          : "border-border hover:border-primary/30 hover:shadow-md",
      )}
    >
      {/* Top accent bar */}
      <div
        className="absolute inset-x-0 top-0 h-0.5 opacity-70"
        style={{ backgroundColor: meta.color }}
      />
      {/* Category badge + step count */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium",
            meta.badge,
          )}
        >
          <CatIcon className="h-2.5 w-2.5" /> {template.category}
        </span>
        <span className="text-[10px] text-muted-foreground">
          {template.steps.length} steps
        </span>
      </div>

      {/* Name + description */}
      <h3 className="text-sm font-semibold leading-snug">{template.name}</h3>
      <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-muted-foreground">
        {template.description}
      </p>

      {/* Step trace mini-preview */}
      <div className="mt-3 space-y-1">
        {template.steps.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <span
              className={cn(
                "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded text-[8px] font-bold uppercase",
                KIND_COLOR[s.kind],
              )}
            >
              {s.kind[0]}
            </span>
            <span className="truncate text-muted-foreground">{s.label}</span>
          </div>
        ))}
      </div>

      {/* Meta row */}
      <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-2.5 w-2.5" /> {template.schedule}
        </span>
        <span>·</span>
        <span className="inline-flex items-center gap-1">
          <Users className="h-2.5 w-2.5" /> {template.popularity.toLocaleString()} installs
        </span>
      </div>

      {/* Action */}
      <div className="mt-3 pt-3">
        {installed ? (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 flex-1 gap-1.5 border-primary/30 text-[11px] text-primary"
              onClick={onViewAgents}
            >
              <ArrowRight className="h-3 w-3" /> View in agents
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive"
              onClick={onUninstall}
              title="Remove"
            >
              Remove
            </Button>
          </div>
        ) : (
          <Button
            size="sm"
            className="h-7 w-full gap-1.5 text-[11px]"
            onClick={onInstall}
          >
            <Plus className="h-3 w-3" /> Use template
          </Button>
        )}
      </div>
    </div>
  );
}


