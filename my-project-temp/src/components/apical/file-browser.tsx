"use client";

/**
 * Desktop file browser — browse granted folder roots (like Cursor workspace
 * folders), grant/revoke roots, and attach files to the chat as local-path
 * references the agent can read with fs_read.
 */

import * as React from "react";
import {
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  X,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { IS_TAURI } from "@/lib/desktop/tauri-bridge";
import { formatBytes, mimeForFilename } from "@/lib/apical/attachments";
import type { ChatAttachment } from "@/lib/apical";

interface GrantedRoot {
  id: string;
  path: string;
  label: string | null;
}

interface DirEntry {
  name: string;
  type: "directory" | "file" | "other";
  size: number;
}

interface FileBrowserProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAttach: (attachments: ChatAttachment[]) => void;
  agentId?: string | null;
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
}

export function FileBrowser({ open, onOpenChange, onAttach, agentId }: FileBrowserProps) {
  const [roots, setRoots] = React.useState<GrantedRoot[]>([]);
  // null = showing the roots list (top level).
  const [currentPath, setCurrentPath] = React.useState<string | null>(null);
  const [currentRoot, setCurrentRoot] = React.useState<GrantedRoot | null>(null);
  const [entries, setEntries] = React.useState<DirEntry[]>([]);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState(false);
  const [attaching, setAttaching] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const loadRoots = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/desktop/fs");
      const data = (await res.json()) as { roots?: GrantedRoot[]; error?: string };
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRoots(data.roots ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDir = React.useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/desktop/fs?path=${encodeURIComponent(path)}`);
      const data = (await res.json()) as { entries?: DirEntry[]; error?: string };
      if (!res.ok) {
        throw new Error(
          data.error === "desktop_offline"
            ? "Desktop is offline — open the Apical desktop app to browse files."
            : data.error || `HTTP ${res.status}`,
        );
      }
      const sorted = (data.entries ?? []).sort((a, b) => {
        if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setEntries(sorted);
      setCurrentPath(path);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      setCurrentPath(null);
      setCurrentRoot(null);
      setSelected(new Set());
      void loadRoots();
    }
  }, [open, loadRoots]);

  async function grantFolder() {
    try {
      let path: string | null = null;
      if (IS_TAURI) {
        const { open: openDialog } = await import("@tauri-apps/plugin-dialog");
        const picked = await openDialog({ directory: true, multiple: false });
        if (picked) path = String(picked);
      } else {
        path = window.prompt("Absolute folder path to grant (e.g. ~/Documents/Clients):");
      }
      if (!path?.trim()) return;
      const res = await fetch("/api/desktop/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: path.trim() }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      await loadRoots();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function revokeRoot(root: GrantedRoot) {
    try {
      await fetch(`/api/desktop/folders/${root.id}`, { method: "DELETE" });
      await loadRoots();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function toggleSelect(path: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  async function attachSelected() {
    if (selected.size === 0) return;
    setAttaching(true);
    setError(null);
    try {
      const attachments: ChatAttachment[] = [];
      for (const path of selected) {
        const name = path.split(/[/\\]/).pop() || path;
        const res = await fetch("/api/assets", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            type: "file",
            localPath: path,
            name,
            mimeType: mimeForFilename(name),
            agentId: agentId ?? null,
          }),
        });
        const data = (await res.json().catch(() => ({}))) as {
          asset?: ChatAttachment;
          error?: string;
        };
        if (!res.ok || !data.asset) throw new Error(data.error || `Attach failed (${res.status})`);
        attachments.push(data.asset);
      }
      onAttach(attachments);
      onOpenChange(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAttaching(false);
    }
  }

  // Breadcrumb segments relative to the current root.
  const crumbs = React.useMemo(() => {
    if (!currentPath || !currentRoot) return [];
    const rel = currentPath.slice(currentRoot.path.length).replace(/^[/\\]/, "");
    const parts = rel ? rel.split(/[/\\]/) : [];
    const out: Array<{ label: string; path: string }> = [
      { label: currentRoot.label || currentRoot.path, path: currentRoot.path },
    ];
    let acc = currentRoot.path;
    for (const part of parts) {
      acc = joinPath(acc, part);
      out.push({ label: part, path: acc });
    }
    return out;
  }, [currentPath, currentRoot]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[70vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Desktop files</DialogTitle>
          <DialogDescription>
            The agent can only access folders you grant. Select files to attach them to the chat.
          </DialogDescription>
        </DialogHeader>

        {/* Breadcrumbs */}
        <div className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
          <button
            type="button"
            className="rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
            onClick={() => {
              setCurrentPath(null);
              setCurrentRoot(null);
              setSelected(new Set());
              void loadRoots();
            }}
          >
            Granted folders
          </button>
          {crumbs.map((c) => (
            <React.Fragment key={c.path}>
              <ChevronRight className="h-3 w-3 shrink-0 opacity-50" />
              <button
                type="button"
                className="max-w-[140px] truncate rounded px-1 py-0.5 hover:bg-accent hover:text-foreground"
                onClick={() => void loadDir(c.path)}
              >
                {c.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
            {error}
          </p>
        )}

        <div className="min-h-[200px] flex-1 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <div className="flex h-full min-h-[200px] items-center justify-center">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : currentPath === null ? (
            roots.length === 0 ? (
              <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 p-4 text-center">
                <FolderOpen className="h-6 w-6 text-muted-foreground" />
                <p className="text-xs text-muted-foreground">
                  No folders granted yet. Grant a folder to let the agent (and this browser) access it.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {roots.map((root) => (
                  <li key={root.id} className="group flex items-center gap-2 px-2 py-1.5">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm hover:text-foreground"
                      onClick={() => {
                        setCurrentRoot(root);
                        void loadDir(root.path);
                      }}
                    >
                      <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="truncate">{root.label || root.path}</span>
                      <span className="truncate text-[10px] text-muted-foreground">{root.path}</span>
                    </button>
                    <button
                      type="button"
                      title="Revoke access"
                      className="rounded p-1 text-muted-foreground opacity-0 transition hover:bg-accent hover:text-destructive group-hover:opacity-100"
                      onClick={() => void revokeRoot(root)}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : entries.length === 0 ? (
            <p className="p-4 text-center text-xs text-muted-foreground">Empty folder.</p>
          ) : (
            <ul className="divide-y divide-border">
              {entries.map((entry) => {
                const full = joinPath(currentPath, entry.name);
                const isDir = entry.type === "directory";
                const isSelected = selected.has(full);
                return (
                  <li key={entry.name}>
                    <button
                      type="button"
                      className={cn(
                        "flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm transition",
                        isSelected ? "bg-primary/10" : "hover:bg-accent",
                      )}
                      onClick={() => {
                        if (isDir) void loadDir(full);
                        else if (entry.type === "file") toggleSelect(full);
                      }}
                    >
                      {isDir ? (
                        <Folder className="h-4 w-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <File
                          className={cn(
                            "h-4 w-4 shrink-0",
                            isSelected ? "text-primary" : "text-muted-foreground",
                          )}
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate">{entry.name}</span>
                      {entry.type === "file" && entry.size > 0 && (
                        <span className="text-[10px] text-muted-foreground">
                          {formatBytes(entry.size)}
                        </span>
                      )}
                      {isDir && <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-40" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="flex-row items-center justify-between gap-2 sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={() => void grantFolder()}>
            <FolderPlus className="mr-1.5 h-3.5 w-3.5" />
            Grant folder
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={selected.size === 0 || attaching}
            onClick={() => void attachSelected()}
          >
            {attaching && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
            Attach {selected.size > 0 ? `${selected.size} file${selected.size === 1 ? "" : "s"}` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
