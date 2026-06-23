"use client";

import * as React from "react";
import { DEMO_WORKFLOWS, relativeTime } from '@/lib/apical';
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Database,
  Table as TableIcon,
  FileText,
  FileJson,
  FileSpreadsheet,
  Download,
  Plus,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  X,
  ChevronRight,
} from "lucide-react";

// ─── Demo data ──────────────────────────────────────────────────────────────

type DataRow = Record<string, string | number>;

const TABLES: {
  id: string;
  name: string;
  agent: string;
  columns: { key: string; label: string; type: "text" | "number" | "date" | "badge" }[];
  rows: DataRow[];
}[] = [
  {
    id: "t1",
    name: "Inbox triage",
    agent: "Atlas",
    columns: [
      { key: "from", label: "From", type: "text" },
      { key: "subject", label: "Subject", type: "text" },
      { key: "category", label: "Category", type: "badge" },
      { key: "priority", label: "Priority", type: "badge" },
      { key: "received", label: "Received", type: "date" },
      { key: "items", label: "Items", type: "number" },
    ],
    rows: [
      { from: "acme@billing.com", subject: "Invoice #4821 — overdue", category: "billing", priority: "high", received: "2026-06-21T08:14:00Z", items: 1 },
      { from: "support@stripe.com", subject: "New dispute opened", category: "billing", priority: "high", received: "2026-06-21T07:42:00Z", items: 1 },
      { from: "jordan@team.com", subject: "Re: Q3 roadmap", category: "internal", priority: "medium", received: "2026-06-21T06:30:00Z", items: 3 },
      { from: "newsletter@hackernews", subject: "Daily digest", category: "newsletter", priority: "low", received: "2026-06-21T05:00:00Z", items: 12 },
      { from: "hr@apical.dev", subject: "Benefits enrollment", category: "hr", priority: "medium", received: "2026-06-20T22:15:00Z", items: 1 },
      { from: "client@northcorp.com", subject: "Contract amendment v3", category: "client", priority: "high", received: "2026-06-20T18:45:00Z", items: 2 },
      { from: "alerts@github.com", subject: "Security advisory", category: "dev", priority: "high", received: "2026-06-20T16:20:00Z", items: 1 },
      { from: "no-reply@linkedin.com", subject: "5 new connection requests", category: "social", priority: "low", received: "2026-06-20T14:10:00Z", items: 5 },
      { from: "billing@aws.com", subject: "May invoice $2,847", category: "billing", priority: "medium", received: "2026-06-20T09:00:00Z", items: 1 },
      { from: "support@linear.app", subject: "Weekly issue summary", category: "dev", priority: "low", received: "2026-06-19T20:30:00Z", items: 18 },
    ],
  },
  {
    id: "t2",
    name: "Overdue invoices",
    agent: "Compass",
    columns: [
      { key: "client", label: "Client", type: "text" },
      { key: "invoice", label: "Invoice #", type: "text" },
      { key: "amount", label: "Amount", type: "number" },
      { key: "due", label: "Due date", type: "date" },
      { key: "days", label: "Days late", type: "number" },
      { key: "status", label: "Status", type: "badge" },
    ],
    rows: [
      { client: "Acme Corp", invoice: "INV-4821", amount: 12400, due: "2026-05-15", days: 37, status: "escalated" },
      { client: "North Industries", invoice: "INV-4798", amount: 8750, due: "2026-05-28", days: 24, status: "reminder-2" },
      { client: "Globex", invoice: "INV-4775", amount: 3200, due: "2026-06-01", days: 20, status: "reminder-1" },
      { client: "Initech", invoice: "INV-4760", amount: 15800, due: "2026-06-05", days: 16, status: "reminder-1" },
      { client: "Umbrella LLC", invoice: "INV-4742", amount: 5600, due: "2026-06-10", days: 11, status: "reminder-1" },
      { client: "Stark Inc", invoice: "INV-4721", amount: 24700, due: "2026-06-14", days: 7, status: "pending" },
    ],
  },
  {
    id: "t3",
    name: "Competitor pricing",
    agent: "Sentinel",
    columns: [
      { key: "competitor", label: "Competitor", type: "text" },
      { key: "plan", label: "Plan", type: "text" },
      { key: "price", label: "Price ($/mo)", type: "number" },
      { key: "seats", label: "Seats", type: "number" },
      { key: "lastChange", label: "Last change", type: "date" },
      { key: "trend", label: "Trend", type: "badge" },
    ],
    rows: [
      { competitor: "Rival.io", plan: "Pro", price: 29, seats: 5, lastChange: "2026-06-20", trend: "up" },
      { competitor: "Rival.io", plan: "Team", price: 79, seats: 10, lastChange: "2026-06-18", trend: "up" },
      { competitor: "Competa", plan: "Starter", price: 12, seats: 1, lastChange: "2026-06-15", trend: "down" },
      { competitor: "Competa", plan: "Business", price: 49, seats: 5, lastChange: "2026-06-15", trend: "same" },
      { competitor: "Outwork", plan: "Free", price: 0, seats: 1, lastChange: "2026-06-01", trend: "same" },
      { competitor: "Outwork", plan: "Pro", price: 24, seats: 3, lastChange: "2026-05-28", trend: "down" },
    ],
  },
];

const FILES: {
  id: string;
  name: string;
  agent: string;
  type: "json" | "csv" | "text" | "pdf";
  size: string;
  updated: string;
  content: string;
}[] = [
  {
    id: "f1",
    name: "competitor_diff_jun20.json",
    agent: "Sentinel",
    type: "json",
    size: "12 KB",
    updated: "6h ago",
    content: JSON.stringify(
      {
        date: "2026-06-20",
        changes: [
          { competitor: "Rival.io", field: "price", from: 24, to: 29, change: "+$5/mo (+20.8%)" },
          { competitor: "Rival.io", field: "seats", from: 3, to: 5, change: "+2 seats" },
          { competitor: "Competa", field: "price", from: 15, to: 12, change: "-$3/mo (-20%)" },
        ],
        summary: "Rival.io raised Pro tier pricing by ~21% and added 2 seats. Competa lowered Starter pricing by 20%.",
        action: "Consider messaging on value-per-seat vs Rival.io.",
      },
      null,
      2,
    ),
  },
  {
    id: "f2",
    name: "expense_audit_q2.csv",
    agent: "Tally",
    type: "csv",
    size: "1.4 MB",
    updated: "yesterday",
    content:
      "date,employee,category,amount,status,notes\n2026-04-03,Jordan,Travel,1240.00,approved,Client visit NYC\n2026-04-08,Sam,Meals,87.50,approved,Team lunch\n2026-04-15,Jordan,Software,499.00,flagged,Missing receipt\n2026-04-22,Priya,Travel,2100.00,flagged,Over $500 threshold\n2026-05-01,Sam,Meals,42.00,approved,Client coffee\n2026-05-10,Jordan,Hardware,1899.00,flagged,Over $500 threshold\n2026-05-18,Priya,Travel,680.00,approved,Conference travel\n2026-05-26,Sam,Software,29.00,approved,Monthly subscription\n2026-06-02,Jordan,Meals,156.00,approved,Client dinner\n2026-06-15,Priya,Hardware,320.00,approved,Keyboard + mouse",
  },
  {
    id: "f3",
    name: "weekly_summary_2026-06-20.txt",
    agent: "Atlas",
    type: "text",
    size: "4.2 KB",
    updated: "1h ago",
    content: `WEEKLY SUMMARY — Week of June 14-20, 2026

=== AGENTS AT WORK ===

Compass (Filing)
  - 312 files sorted into client folders
  - 2 new client folders created (Acme Corp, North Industries)
  - 8 items flagged for review (missing dates, unrecognizable)

Atlas (Client comms)
  - 47 onboarding emails drafted
  - 12 client check-ins sent
  - 3 drafts awaiting your approval

Sentinel (Competitor watch)
  - 3 pricing changes detected this week
  - Rival.io raised Pro tier +20.8%
  - Competa lowered Starter -20%
  - 1 new product launch flagged (Outwork v2)

Tally (Expense audit)
  - 87 expense reports processed
  - 12 flagged for review (over $500 or missing receipt)
  - $14,240 auto-approved
  - $3,847 flagged for human review

Beacon (Reminders)
  - 3 license renewals in next 30 days
  - 1 contract expiry (Globex MSA — July 10)
  - 0 missed deadlines

=== ITEMS NEEDING YOUR ATTENTION ===

1. [HIGH] Acme Corp invoice #4821 — 37 days overdue ($12,400)
2. [HIGH] 2 expense reports over $500 need approval
3. [MED] 3 Rival.io pricing changes — consider response
4. [MED] Globex MSA expires in 20 days — renewal draft ready
5. [LOW] 8 filing items with missing dates — Compass will retry OCR

=== STATS ===

Total items processed: 553
Automatic (no human needed): 521 (94.2%)
Flagged for review: 32 (5.8%)
AI calls saved via hardening: 412

— Generated by Atlas. Have a good weekend, Jordan.`,
  },
  {
    id: "f4",
    name: "sales_prospects_week24.json",
    agent: "Scout",
    type: "json",
    size: "28 KB",
    updated: "3d ago",
    content: JSON.stringify(
      {
        week: 24,
        generated: "2026-06-17",
        criteria: "fintech, 50-200 employees, US-based, hiring",
        prospects: [
          { company: "PayFlow", employees: 87, location: "Austin, TX", hiring: ["Eng", "Sales"], fit: 0.92, contact: "ceo@payflow.io" },
          { company: "Ledgerly", employees: 124, location: "Denver, CO", hiring: ["Eng", "Product"], fit: 0.88, contact: "vp@ledgerly.com" },
          { company: "TrustBank", employees: 203, location: "NYC, NY", hiring: ["Sales", "Ops"], fit: 0.81, contact: "growth@trustbank.co" },
        ],
      },
      null,
      2,
    ),
  },
];

// ─── Data tab ────────────────────────────────────────────────────────────────

export function DataTab() {
  const [activeTable, setActiveTable] = React.useState<string | null>(null);
  const [activeFile, setActiveFile] = React.useState<string | null>(null);

  const table = TABLES.find((t) => t.id === activeTable);
  const file = FILES.find((f) => f.id === activeFile);

  return (
    <div className="h-full min-h-0 overflow-hidden">
      {/* Two-pane: left = list, right = viewer */}
      <div className="flex h-full min-h-0">
        {/* Left: data catalog */}
        <div className="w-64 shrink-0 overflow-y-auto overscroll-contain border-r border-border bg-muted/20 p-3">
          <div className="mb-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
              <Database className="h-4 w-4 text-muted-foreground" /> Data
            </h2>
            <p className="mt-0.5 text-[10px] text-muted-foreground">Tables, files, and agent state.</p>
          </div>

          <Section label="Tables">
            {TABLES.map((t) => (
              <CatalogRow
                key={t.id}
                icon={TableIcon}
                name={t.name}
                sub={`${t.rows.length} rows · by ${t.agent}`}
                active={activeTable === t.id}
                onClick={() => {
                  setActiveTable(t.id);
                  setActiveFile(null);
                }}
              />
            ))}
          </Section>

          <Section label="Files">
            {FILES.map((f) => {
              const FileIcon = f.type === "json" ? FileJson : f.type === "csv" ? FileSpreadsheet : FileText;
              return (
                <CatalogRow
                  key={f.id}
                  icon={FileIcon}
                  name={f.name}
                  sub={`${f.size} · by ${f.agent}`}
                  active={activeFile === f.id}
                  onClick={() => {
                    setActiveFile(f.id);
                    setActiveTable(null);
                  }}
                />
              );
            })}
          </Section>

          <Section label="Agent state">
            {DEMO_WORKFLOWS.slice(0, 4).map((w) => (
              <div key={w.id} className="mb-0.5 rounded-md px-2 py-1.5 text-[11px]">
                <div className="font-medium">{w.name}</div>
                <div className="text-[9px] text-muted-foreground">{w.department} · {relativeTime(w.updatedAt)}</div>
              </div>
            ))}
          </Section>
        </div>

        {/* Right: viewer */}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {table && <TableView table={table} />}
          {file && <FileView file={file} />}
          {!table && !file && <EmptyViewer />}
        </div>
      </div>
    </div>
  );
}

// ─── Table viewer with sorting ──────────────────────────────────────────────

function TableView({
  table,
}: {
  table: { id: string; name: string; agent: string; columns: { key: string; label: string; type: "text" | "number" | "date" | "badge" }[]; rows: DataRow[] };
}) {
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [search, setSearch] = React.useState("");

  const sortedRows = React.useMemo(() => {
    let rows = table.rows;
    if (search) {
      const q = search.toLowerCase();
      rows = rows.filter((r) =>
        Object.values(r).some((v) => String(v).toLowerCase().includes(q)),
      );
    }
    if (!sortKey) return rows;
    const col = table.columns.find((c) => c.key === sortKey);
    if (!col) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (col.type === "number") return (Number(av) - Number(bv)) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [table, sortKey, sortDir, search]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <TableIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{table.name}</span>
        <span className="text-[10px] text-muted-foreground">· {table.rows.length} rows · by {table.agent}</span>
        <div className="ml-auto flex items-center gap-1.5">
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2 py-0.5">
            <Search className="h-3 w-3 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter rows…"
              className="w-32 bg-transparent text-[11px] placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]">
            <Download className="h-3 w-3" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
            <tr>
              {table.columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col.key)}
                  className="cursor-pointer select-none border-b border-border px-3 py-2 font-medium text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                >
                  <span className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-primary" /> : <ArrowDown className="h-3 w-3 text-primary" />
                    ) : (
                      <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, i) => (
              <tr key={i} className="border-b border-border/50 transition-colors hover:bg-accent/30">
                {table.columns.map((col) => (
                  <td key={col.key} className="px-3 py-1.5 align-top">
                    {renderCell(col.type, row[col.key])}
                  </td>
                ))}
              </tr>
            ))}
            {sortedRows.length === 0 && (
              <tr>
                <td colSpan={table.columns.length} className="px-3 py-8 text-center text-muted-foreground">
                  No rows match &quot;{search}&quot;
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Showing {sortedRows.length} of {table.rows.length} rows
        {sortKey && ` · sorted by ${table.columns.find((c) => c.key === sortKey)?.label} ${sortDir}`}
      </div>
    </div>
  );
}

function renderCell(type: "text" | "number" | "date" | "badge", value: string | number) {
  if (type === "number") return <span className="font-mono tabular-nums">{value}</span>;
  if (type === "date") {
    const d = new Date(String(value));
    const valid = !isNaN(d.getTime());
    return <span className="text-muted-foreground">{valid ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : String(value)}</span>;
  }
  if (type === "badge") return <BadgeCell value={String(value)} />;
  return <span>{value}</span>;
}

function BadgeCell({ value }: { value: string }) {
  const styles: Record<string, string> = {
    high: "bg-destructive/10 text-destructive border-destructive/30",
    medium: "bg-amber-500/10 text-amber-700 border-amber-500/30",
    low: "bg-muted text-muted-foreground border-border",
    escalated: "bg-destructive/10 text-destructive border-destructive/30",
    "reminder-2": "bg-amber-500/10 text-amber-700 border-amber-500/30",
    "reminder-1": "bg-amber-500/5 text-amber-600 border-amber-500/20",
    pending: "bg-muted text-muted-foreground border-border",
    up: "bg-destructive/10 text-destructive border-destructive/30",
    down: "bg-emerald-500/10 text-emerald-700 border-emerald-500/30",
    same: "bg-muted text-muted-foreground border-border",
  };
  const cls = styles[value] ?? "bg-muted text-muted-foreground border-border";
  return <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium capitalize", cls)}>{value}</span>;
}

// ─── File viewer ────────────────────────────────────────────────────────────

function FileView({ file }: { file: { id: string; name: string; agent: string; type: "json" | "csv" | "text" | "pdf"; size: string; updated: string; content: string } }) {
  const Icon = file.type === "json" ? FileJson : file.type === "csv" ? FileSpreadsheet : FileText;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{file.name}</span>
        <span className="text-[10px] text-muted-foreground">· {file.size} · by {file.agent} · {file.updated}</span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-[11px]">
          <Download className="h-3 w-3" /> Download
        </Button>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain bg-zinc-950 p-4">
        {file.type === "json" && <JsonView content={file.content} />}
        {file.type === "csv" && <CsvView content={file.content} />}
        {file.type === "text" && <TextView content={file.content} />}
        {file.type === "pdf" && <PdfPlaceholder name={file.name} />}
      </div>
    </div>
  );
}

function JsonView({ content }: { content: string }) {
  return (
    <pre className="overflow-auto font-mono text-[11px] leading-relaxed text-zinc-300">
      <code>{content}</code>
    </pre>
  );
}

function CsvView({ content }: { content: string }) {
  const rows = content.trim().split("\n").map((r) => r.split(","));
  if (rows.length === 0) return null;
  const headers = rows[0];
  return (
    <table className="w-full border-collapse text-left font-mono text-[11px]">
      <thead>
        <tr>
          {headers.map((h, i) => (
            <th key={i} className="border-b border-zinc-700 px-2 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.slice(1).map((row, i) => (
          <tr key={i} className="border-b border-zinc-800/50">
            {headers.map((_, j) => (
              <td key={j} className="px-2 py-1 text-zinc-300">
                {row[j] ?? ""}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TextView({ content }: { content: string }) {
  return (
    <pre className="overflow-auto whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-zinc-300">
      {content}
    </pre>
  );
}

function PdfPlaceholder({ name }: { name: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <FileText className="mx-auto mb-3 h-12 w-12 text-zinc-600" />
        <p className="text-sm text-zinc-400">{name}</p>
        <p className="mt-1 text-[11px] text-zinc-600">PDF rendering requires the desktop app or a browser PDF viewer.</p>
        <Button size="sm" variant="outline" className="mt-3 gap-1.5 border-zinc-700 text-zinc-300">
          <Download className="h-3 w-3" /> Download to view
        </Button>
      </div>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyViewer() {
  return (
    <div className="flex h-full items-center justify-center bg-muted/10">
      <div className="max-w-sm text-center">
        <Database className="mx-auto mb-3 h-10 w-10 text-muted-foreground/40" />
        <h3 className="text-sm font-semibold">Select a table or file</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Pick an item from the left to view it. Tables are sortable — click any column header. Files render inline (JSON, CSV, text).
        </p>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-1.5 px-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      {children}
    </div>
  );
}

function CatalogRow({
  icon: Icon,
  name,
  sub,
  active,
  onClick,
}: {
  icon: typeof TableIcon;
  name: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition-colors",
        active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <div className="truncate text-[9px] text-muted-foreground">{sub}</div>
      </div>
      <ChevronRight className={cn("h-3 w-3 shrink-0 transition", active ? "text-primary" : "text-muted-foreground/40")} />
    </button>
  );
}

// (fileIcon helper removed — icons are resolved inline via ternary to satisfy
// react-hooks/static-components lint rule.)

void Input;
void Plus;
void X;
