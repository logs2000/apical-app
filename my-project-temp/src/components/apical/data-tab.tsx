"use client";

import * as React from "react";
import { relativeTime } from "@/lib/apical";
import { listAssets, formatBytes } from "@/lib/apical/attachments";
import type { ChatAttachment } from "@/lib/apical";
import {
  useDataTables,
  useDataTable,
  useWorkflows,
  type DataTableDto,
} from "@/lib/queries";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Database,
  Table as TableIcon,
  FileText,
  FileJson,
  FileSpreadsheet,
  Download,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronRight,
  Loader2,
} from "lucide-react";

// ─── Data tab ────────────────────────────────────────────────────────────────
// Everything here is live: tables come from /api/tables (DataTable rows agents
// create), files from /api/assets, and agent state from the user's real agents.

export function DataTab() {
  const [activeTable, setActiveTable] = React.useState<string | null>(null);
  const [activeFile, setActiveFile] = React.useState<string | null>(null);
  const [liveAssets, setLiveAssets] = React.useState<ChatAttachment[]>([]);

  const { data: tables, isLoading: tablesLoading } = useDataTables();
  const { data: workflows } = useWorkflows();

  React.useEffect(() => {
    void listAssets().then(setLiveAssets).catch(() => setLiveAssets([]));
  }, []);

  const asset = liveAssets.find((a) => a.id === activeFile);

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
            {tablesLoading ? (
              <div className="flex items-center gap-2 px-2 py-3 text-[10px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> Loading…
              </div>
            ) : !tables || tables.length === 0 ? (
              <p className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                No tables yet. Agents create tables when their workflows produce
                structured data.
              </p>
            ) : (
              tables.map((t) => (
                <CatalogRow
                  key={t.id}
                  icon={TableIcon}
                  name={t.name}
                  sub={`${t.rowCount} ${t.rowCount === 1 ? "row" : "rows"}${t.description ? ` · ${t.description}` : ""}`}
                  active={activeTable === t.id}
                  onClick={() => {
                    setActiveTable(t.id);
                    setActiveFile(null);
                  }}
                />
              ))
            )}
          </Section>

          <Section label="Files">
            {liveAssets.length === 0 ? (
              <p className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                No files yet. Files you upload in chat and files agents generate
                land here.
              </p>
            ) : (
              liveAssets.map((a) => {
                const FileIcon =
                  a.kind === "image" ? FileText : a.mimeType.includes("json") ? FileJson : a.mimeType.includes("csv") ? FileSpreadsheet : FileText;
                return (
                  <CatalogRow
                    key={a.id}
                    icon={FileIcon}
                    name={a.name}
                    sub={`${a.sizeBytes ? formatBytes(a.sizeBytes) : a.kind} · ${a.source ?? "saved"}`}
                    active={activeFile === a.id}
                    onClick={() => {
                      setActiveFile(a.id);
                      setActiveTable(null);
                    }}
                  />
                );
              })
            )}
          </Section>

          <Section label="Agent state">
            {!workflows || workflows.length === 0 ? (
              <p className="px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
                No agents yet.
              </p>
            ) : (
              workflows.slice(0, 6).map((w) => (
                <div key={w.id} className="mb-0.5 rounded-md px-2 py-1.5 text-[11px]">
                  <div className="font-medium">{w.name}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {w.runsCount} {w.runsCount === 1 ? "run" : "runs"} · {relativeTime(w.updatedAt)}
                  </div>
                </div>
              ))
            )}
          </Section>
        </div>

        {/* Right: viewer */}
        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          {activeTable ? (
            <TableView tableId={activeTable} />
          ) : asset ? (
            <AssetView asset={asset} />
          ) : (
            <EmptyViewer />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Table viewer with sorting (live rows from /api/tables/[id]) ────────────

function TableView({ tableId }: { tableId: string }) {
  const { data, isLoading, error } = useDataTable(tableId);
  const [sortKey, setSortKey] = React.useState<string | null>(null);
  const [sortDir, setSortDir] = React.useState<"asc" | "desc">("asc");
  const [search, setSearch] = React.useState("");

  const table = data?.table;
  const rows = React.useMemo(() => data?.rows ?? [], [data?.rows]);

  const sortedRows = React.useMemo(() => {
    let list = rows;
    if (search) {
      const q = search.toLowerCase();
      list = list.filter((r) =>
        Object.values(r.data).some((v) => String(v ?? "").toLowerCase().includes(q)),
      );
    }
    if (!sortKey || !table) return list;
    const col = table.columns.find((c) => c.name === sortKey);
    if (!col) return list;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      const av = a.data[sortKey];
      const bv = b.data[sortKey];
      if (col.type === "number") return (Number(av) - Number(bv)) * dir;
      return String(av ?? "").localeCompare(String(bv ?? "")) * dir;
    });
  }, [rows, table, sortKey, sortDir, search]);

  function toggleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }

  function exportCsv() {
    if (!table) return;
    const esc = (v: unknown) => {
      const s = typeof v === "object" && v !== null ? JSON.stringify(v) : String(v ?? "");
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      table.columns.map((c) => esc(c.name)).join(","),
      ...sortedRows.map((r) => table.columns.map((c) => esc(r.data[c.name])).join(",")),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${table.name.replace(/[^a-z0-9-_]+/gi, "_")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Loading table…
      </div>
    );
  }
  if (error || !table) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        Could not load this table.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <TableIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-sm font-medium">{table.name}</span>
        <span className="text-[10px] text-muted-foreground">· {data.total} {data.total === 1 ? "row" : "rows"}</span>
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
          <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={exportCsv}>
            <Download className="h-3 w-3" /> Export CSV
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="min-h-0 flex-1 overflow-auto overscroll-contain">
        {table.columns.length === 0 || rows.length === 0 ? (
          <div className="flex h-full items-center justify-center p-6 text-center text-xs text-muted-foreground">
            {table.columns.length === 0
              ? "This table has no column schema yet."
              : "No rows yet — the agent hasn't written any data to this table."}
          </div>
        ) : (
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
              <tr>
                {table.columns.map((col) => (
                  <th
                    key={col.name}
                    onClick={() => toggleSort(col.name)}
                    className="cursor-pointer select-none border-b border-border px-3 py-2 font-medium text-[10px] uppercase tracking-wide text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <span className="flex items-center gap-1">
                      {col.name}
                      {sortKey === col.name ? (
                        sortDir === "asc" ? <ArrowUp className="h-3 w-3 text-foreground" /> : <ArrowDown className="h-3 w-3 text-foreground" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 text-muted-foreground/40" />
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((row) => (
                <tr key={row.id} className="border-b border-border/50 transition-colors hover:bg-accent/30">
                  {table.columns.map((col) => (
                    <td key={col.name} className="px-3 py-1.5 align-top">
                      {renderCell(col.type, row.data[col.name])}
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
        )}
      </div>

      {/* Status bar */}
      <div className="shrink-0 border-t border-border px-3 py-1.5 text-[10px] text-muted-foreground">
        Showing {sortedRows.length} of {data.total} rows
        {sortKey && ` · sorted by ${sortKey} ${sortDir}`}
      </div>
    </div>
  );
}

function renderCell(type: DataTableDto["columns"][number]["type"], value: unknown) {
  if (value === null || value === undefined || value === "") {
    return <span className="text-muted-foreground/50">—</span>;
  }
  if (type === "number") return <span className="font-mono tabular-nums">{String(value)}</span>;
  if (type === "boolean") {
    return (
      <span className={cn("inline-block rounded border px-1.5 py-0.5 text-[10px] font-medium", value ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700" : "border-border bg-muted text-muted-foreground")}>
        {String(value)}
      </span>
    );
  }
  if (type === "date") {
    const d = new Date(String(value));
    const valid = !isNaN(d.getTime());
    return <span className="text-muted-foreground">{valid ? d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : String(value)}</span>;
  }
  if (type === "json") {
    return <code className="font-mono text-[10px] text-muted-foreground">{JSON.stringify(value)}</code>;
  }
  return <span>{String(value)}</span>;
}

// ─── Live asset viewer (uploads + agent-generated) ───────────────────────────

function AssetView({ asset }: { asset: ChatAttachment }) {
  const isImage = asset.kind === "image" || asset.mimeType.startsWith("image/");
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <FileText className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate text-sm font-medium">{asset.name}</span>
        <span className="text-[10px] text-muted-foreground">
          · {asset.sizeBytes ? formatBytes(asset.sizeBytes) : asset.kind}
        </span>
        <Button size="sm" variant="ghost" className="ml-auto h-7 gap-1 text-[11px]" asChild>
          <a href={asset.url} download={asset.name}>
            <Download className="h-3 w-3" /> Download
          </a>
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={asset.url} alt={asset.name} className="max-h-full max-w-full rounded-md border border-border" />
        ) : asset.localPath ? (
          <div className="rounded-md border border-border bg-muted/30 p-4 text-sm">
            <div className="font-medium">Local folder</div>
            <code className="mt-2 block text-xs text-muted-foreground">{asset.localPath}</code>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            Use the Download button above to view this file, or open it from chat.
          </div>
        )}
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
          Pick an item from the left to view it. Tables are sortable — click any
          column header. Everything here is produced by your agents or uploaded
          by you.
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
        active ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{name}</div>
        <div className="truncate text-[9px] text-muted-foreground">{sub}</div>
      </div>
      <ChevronRight className={cn("h-3 w-3 shrink-0 transition", active ? "text-foreground" : "text-muted-foreground/40")} />
    </button>
  );
}
