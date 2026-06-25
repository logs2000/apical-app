"use client";

import * as React from "react";
import {
  Terminal,
  Code2,
  Globe,
  Database,
  FileText,
  Image as ImageIcon,
  X,
  Trash2,
  AlertCircle,
  CheckCircle2,
  ListChecks,
  Download,
  ExternalLink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/lib/apical/store";
import {
  extractTableRows,
  formatSandboxOutput,
  type PreviewFormat,
  type SandboxDisplayKind,
  type SandboxItem,
} from "@/lib/apical/sandbox";
import { MarkdownText } from "./markdown-text";

const KIND_ICON: Record<SandboxDisplayKind, React.ComponentType<{ className?: string }>> = {
  search: Globe,
  http: Globe,
  code: Code2,
  cli: Terminal,
  data: Database,
  workflow: FileText,
  info: FileText,
  image: ImageIcon,
  file: FileText,
};

function FileDownloadCard({ item }: { item: SandboxItem }) {
  const url = item.assetUrl ?? (item.assetId ? `/api/assets/${item.assetId}/download` : null);
  const Icon = item.resultFormat === "image" ? ImageIcon : FileText;
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      download={item.assetName ?? item.title}
      className="flex items-center gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/30"
    >
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium">{item.assetName ?? item.title}</p>
        <p className="text-[10px] text-muted-foreground">{item.summary}</p>
      </div>
      <Download className="h-4 w-4 shrink-0 text-muted-foreground" />
    </a>
  );
}

/** User-facing deliverable — tables, files, images, readable content. */
function PreviewDeliverableView({ item }: { item: SandboxItem }) {
  const formatted = formatSandboxOutput(item.output);
  const format: PreviewFormat = item.resultFormat ?? "text";
  const rows = formatted.rows ?? extractTableRows(item.output);

  if (format === "image" && item.assetUrl) {
    return (
      <article className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <h3 className="truncate text-xs font-semibold">{item.title}</h3>
          {item.summary && <p className="text-[10px] text-muted-foreground">{item.summary}</p>}
        </div>
        <div className="p-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={item.assetUrl}
            alt={item.assetName ?? item.title}
            className="max-h-80 w-full rounded-md object-contain"
          />
        </div>
        {item.assetUrl && (
          <div className="border-t border-border px-3 py-2">
            <a
              href={item.assetUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            >
              Open full size <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        )}
      </article>
    );
  }

  if (format === "file") {
    return <FileDownloadCard item={item} />;
  }

  if (format === "table" && rows && rows.length > 0) {
    const cols = Object.keys(rows[0]).slice(0, 10);
    return (
      <article className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <h3 className="truncate text-xs font-semibold">{item.title}</h3>
          <p className="text-[10px] text-muted-foreground">
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </p>
        </div>
        <div className="max-h-[min(420px,60vh)] overflow-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="sticky top-0 bg-muted/90 backdrop-blur-sm">
              <tr>
                {cols.map((col) => (
                  <th key={col} className="whitespace-nowrap px-2.5 py-1.5 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((row, i) => (
                <tr key={i} className="border-t border-border/50 even:bg-muted/20">
                  {cols.map((col) => (
                    <td key={col} className="max-w-[180px] truncate px-2.5 py-1.5 text-muted-foreground">
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 && (
            <p className="border-t border-border px-2.5 py-1.5 text-[10px] text-muted-foreground">
              Showing 200 of {rows.length} rows
            </p>
          )}
        </div>
      </article>
    );
  }

  if (format === "html" && formatted.html) {
    return (
      <article className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-3 py-2">
          <h3 className="truncate text-xs font-semibold">{item.title}</h3>
        </div>
        <iframe
          title={item.title}
          sandbox="allow-same-origin"
          srcDoc={formatted.html}
          className="h-[min(420px,60vh)] w-full border-0 bg-white"
        />
      </article>
    );
  }

  const text =
    formatted.text ??
    (typeof item.output === "string" ? item.output : JSON.stringify(item.output, null, 2));

  if (
    format === "markdown" ||
    text.includes("\n#") ||
    text.includes("\n- ") ||
    /\n\|.*\|/.test(text) ||
    text.includes("|---")
  ) {
    return (
      <article className="rounded-lg border border-border bg-card p-3">
        <h3 className="mb-2 text-xs font-semibold">{item.title}</h3>
        <MarkdownText text={text} />
      </article>
    );
  }

  return (
    <article className="rounded-lg border border-border bg-card p-3">
      <h3 className="mb-2 text-xs font-semibold">{item.title}</h3>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-[11px] leading-relaxed text-foreground">
        {text}
      </pre>
    </article>
  );
}

/** Technical step log — shown in Progress only. */
function ProgressStepView({ item }: { item: SandboxItem }) {
  const Icon = KIND_ICON[item.kind] ?? FileText;
  const formatted = formatSandboxOutput(item.output);

  return (
    <article
      className={cn(
        "rounded-lg border bg-card p-3",
        item.ok ? "border-border" : "border-destructive/40 bg-destructive/5",
      )}
    >
      <div className="mb-2 flex items-start gap-2">
        <div
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            item.ok ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive",
          )}
        >
          {item.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Icon className="h-3 w-3 shrink-0 text-muted-foreground" />
            <h3 className="truncate text-xs font-semibold">{item.title}</h3>
          </div>
          <p className="text-[10px] text-muted-foreground">{item.summary}</p>
        </div>
        <time className="shrink-0 text-[9px] text-muted-foreground">
          {new Date(item.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </time>
      </div>

      {!item.ok && item.error && (
        <pre className="mb-2 overflow-x-auto rounded-md bg-destructive/10 px-2 py-1.5 text-[10px] text-destructive">
          {item.error}
        </pre>
      )}

      {formatted.rows && formatted.rows.length > 0 && (
        <div className="max-h-48 overflow-auto rounded-md border border-border">
          <table className="w-full text-left text-[10px]">
            <thead className="sticky top-0 bg-muted/80">
              <tr>
                {Object.keys(formatted.rows[0]).slice(0, 6).map((col) => (
                  <th key={col} className="whitespace-nowrap px-2 py-1 font-medium">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {formatted.rows.slice(0, 50).map((row, i) => (
                <tr key={i} className="border-t border-border/50">
                  {Object.keys(formatted.rows![0]).slice(0, 6).map((col) => (
                    <td key={col} className="max-w-[120px] truncate px-2 py-1 text-muted-foreground">
                      {String(row[col] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!formatted.rows && formatted.text && (
        <pre
          className={cn(
            "max-h-48 overflow-auto rounded-md px-2 py-1.5 text-[10px] leading-relaxed",
            item.kind === "code" || item.kind === "cli"
              ? "bg-zinc-950 font-mono text-zinc-100"
              : "bg-muted/50 text-foreground",
          )}
        >
          {formatted.text}
        </pre>
      )}
    </article>
  );
}

/**
 * Right-rail panel:
 *  - Preview  → user-facing deliverables (tables, files, images, readable output)
 *  - Progress → full technical working log
 */
export function SandboxPanel({
  mode = "preview",
  showClose = true,
  className,
}: {
  mode?: "preview" | "progress";
  showClose?: boolean;
  className?: string;
}) {
  const allItems = useAppStore((s) => s.sandboxItems);
  const clearSandbox = useAppStore((s) => s.clearSandbox);
  const setSandboxOpen = useAppStore((s) => s.setSandboxOpen);
  const bottomRef = React.useRef<HTMLDivElement>(null);

  const items = React.useMemo(() => {
    if (mode === "progress") return allItems;
    // Preview: deliverables only, dedupe files by asset id
    const results = allItems.filter((i) => i.isResult);
    const seen = new Set<string>();
    return results.filter((item) => {
      if (item.assetId) {
        if (seen.has(item.assetId)) return false;
        seen.add(item.assetId);
      }
      return true;
    });
  }, [allItems, mode]);

  React.useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length]);

  const isPreview = mode === "preview";
  const Heading = isPreview ? Database : ListChecks;
  const label = isPreview ? "Preview" : "Progress";

  return (
    <aside className={cn("flex h-full w-full min-w-0 flex-col overflow-hidden bg-muted/30", className)}>
      <div className="flex shrink-0 items-center gap-2 border-b border-border bg-background/50 px-3 py-2">
        <Heading className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold">{label}</span>
        {!isPreview && (
          <span className="text-[10px] text-muted-foreground">
            {items.length} step{items.length === 1 ? "" : "s"}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          {allItems.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 gap-1 px-2 text-[10px]"
              onClick={clearSandbox}
            >
              <Trash2 className="h-3 w-3" />
              Clear
            </Button>
          )}
          {showClose && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={() => setSandboxOpen(false)}
              title={`Close ${label.toLowerCase()}`}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3">
        {items.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-4 text-center">
            <Heading className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-xs text-muted-foreground">
              {isPreview
                ? "Finished output appears here — tables, images, files, and other results from the run."
                : "Step-by-step activity shows up here as the agent works."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) =>
              isPreview ? (
                <PreviewDeliverableView key={item.id} item={item} />
              ) : (
                <ProgressStepView key={item.id} item={item} />
              ),
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </aside>
  );
}
