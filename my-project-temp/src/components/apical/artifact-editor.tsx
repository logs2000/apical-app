"use client";

import * as React from "react";
import {
  X,
  Play,
  Save,
  Download,
  Plus,
  FileCode2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  CornerUpLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  runArtifact,
  saveArtifact,
  mimeForFilename,
  type ScriptLanguage,
} from "@/lib/apical/attachments";
import type { ChatAttachment } from "@/lib/apical";

interface EditorFile {
  id: string;
  name: string;
  content: string;
  savedAssetId?: string;
  dirty?: boolean;
}

export interface ArtifactEditorInitial {
  name: string;
  content: string;
  assetId?: string;
}

interface ArtifactEditorProps {
  open: boolean;
  onClose: () => void;
  agentId?: string | null;
  /** Called when a file is saved as an artifact (to drop into the chat tray). */
  onSaved?: (asset: ChatAttachment) => void;
  /** Optionally open with a file preloaded (e.g. editing an existing artifact). */
  initialFile?: ArtifactEditorInitial | null;
}

const STARTER: Record<string, string> = {
  js: "// New script\nconst result = 1 + 1;\nresult;\n",
  py: "# New script\nprint('hello from python')\n",
  sh: "# New script\necho 'hello from shell'\n",
};

function runnableLanguage(name: string): ScriptLanguage | null {
  const ext = name.split(".").pop()?.toLowerCase();
  if (ext === "js" || ext === "ts" || ext === "mjs") return "javascript";
  if (ext === "py") return "python";
  if (ext === "sh" || ext === "bash") return "shell";
  return null;
}

function newFile(name = "untitled.js"): EditorFile {
  const ext = name.split(".").pop()?.toLowerCase() ?? "js";
  return {
    id: Math.random().toString(36).slice(2),
    name,
    content: STARTER[ext] ?? "",
    dirty: true,
  };
}

export function ArtifactEditor({
  open,
  onClose,
  agentId,
  onSaved,
  initialFile,
}: ArtifactEditorProps) {
  const { toast } = useToast();
  const [files, setFiles] = React.useState<EditorFile[]>([newFile()]);
  const [activeId, setActiveId] = React.useState<string>("");
  const [output, setOutput] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [running, setRunning] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const taRef = React.useRef<HTMLTextAreaElement>(null);
  const gutterRef = React.useRef<HTMLDivElement>(null);

  // Seed when opened.
  React.useEffect(() => {
    if (!open) return;
    if (initialFile) {
      const f: EditorFile = {
        id: Math.random().toString(36).slice(2),
        name: initialFile.name,
        content: initialFile.content,
        savedAssetId: initialFile.assetId,
        dirty: false,
      };
      setFiles([f]);
      setActiveId(f.id);
    } else {
      setFiles((prev) => {
        if (prev.length) {
          setActiveId(prev[0].id);
          return prev;
        }
        const f = newFile();
        setActiveId(f.id);
        return [f];
      });
    }
    setOutput(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile]);

  const active = files.find((f) => f.id === activeId) ?? files[0];

  function updateActive(content: string) {
    setFiles((prev) =>
      prev.map((f) => (f.id === active.id ? { ...f, content, dirty: true } : f)),
    );
  }

  function renameActive(name: string) {
    setFiles((prev) => prev.map((f) => (f.id === active.id ? { ...f, name, dirty: true } : f)));
  }

  function addFile() {
    const f = newFile(`untitled-${files.length + 1}.js`);
    setFiles((prev) => [...prev, f]);
    setActiveId(f.id);
    setOutput(null);
  }

  function closeFile(id: string) {
    setFiles((prev) => {
      const next = prev.filter((f) => f.id !== id);
      if (next.length === 0) {
        const f = newFile();
        setActiveId(f.id);
        return [f];
      }
      if (id === activeId) setActiveId(next[0].id);
      return next;
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = active.content.slice(0, start) + "  " + active.content.slice(end);
      updateActive(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
    // Cmd/Ctrl+Enter → run
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void run();
    }
    // Cmd/Ctrl+S → save
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      void save();
    }
  }

  async function run() {
    if (!active) return;
    const lang = runnableLanguage(active.name);
    if (!lang) {
      setOutput({
        ok: false,
        text: `Can't run "${active.name}". Runnable types: .js, .py, .sh`,
      });
      return;
    }
    setRunning(true);
    setOutput(null);
    try {
      const res = await runArtifact(lang, active.content);
      let text: string;
      if (res.error) {
        text = res.error;
      } else if (res.output && typeof res.output === "object" && "stdout" in res.output) {
        text = String((res.output as { stdout?: unknown }).stdout ?? "");
      } else if (typeof res.output === "string") {
        text = res.output;
      } else {
        text = JSON.stringify(res.output, null, 2);
      }
      setOutput({ ok: res.ok, text: text || "(no output)" });
    } catch (e) {
      setOutput({ ok: false, text: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  async function save(): Promise<ChatAttachment | null> {
    if (!active) return null;
    setSaving(true);
    try {
      const asset = await saveArtifact({
        name: active.name,
        content: active.content,
        mimeType: mimeForFilename(active.name),
        agentId,
      });
      setFiles((prev) =>
        prev.map((f) =>
          f.id === active.id ? { ...f, savedAssetId: asset.id, dirty: false } : f,
        ),
      );
      onSaved?.(asset);
      toast({ title: "Saved", description: `${active.name} saved to your assets.` });
      return asset;
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message });
      return null;
    } finally {
      setSaving(false);
    }
  }

  function download() {
    if (!active) return;
    const blob = new Blob([active.content], { type: mimeForFilename(active.name) });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = active.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveAndAttach() {
    const asset = await save();
    if (asset) onClose();
  }

  if (!open || !active) return null;

  const lineCount = active.content.split("\n").length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="flex h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl">
        {/* Header */}
        <div className="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
          <FileCode2 className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Code editor</span>
          <span className="text-[10px] text-muted-foreground">Create · edit · run · save</span>
          <button
            onClick={onClose}
            className="ml-auto rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* File tabs */}
        <div className="flex h-9 shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/20 px-2">
          {files.map((f) => (
            <button
              key={f.id}
              onClick={() => {
                setActiveId(f.id);
                setOutput(null);
              }}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-[11px]",
                f.id === activeId
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <FileCode2 className="h-3 w-3" />
              <span className="max-w-[140px] truncate">{f.name}</span>
              {f.dirty && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
              <span
                role="button"
                tabIndex={0}
                className="rounded p-0.5 opacity-0 hover:bg-accent group-hover:opacity-100"
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(f.id);
                }}
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-6 w-6 shrink-0"
            onClick={addFile}
            title="New file"
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Toolbar */}
        <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <input
            value={active.name}
            onChange={(e) => renameActive(e.target.value)}
            className="w-56 rounded border border-input bg-background px-2 py-1 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50"
            spellCheck={false}
          />
          <span className="text-[10px] text-muted-foreground">
            {runnableLanguage(active.name) ?? "not runnable"}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-[11px]"
              onClick={run}
              disabled={running || !runnableLanguage(active.name)}
            >
              {running ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              Run
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-[11px]"
              onClick={save}
              disabled={saving}
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              Save
            </Button>
            <Button size="sm" variant="ghost" className="h-7 gap-1 text-[11px]" onClick={download}>
              <Download className="h-3 w-3" /> Download
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={saveAndAttach}
              disabled={saving}
            >
              <CornerUpLeft className="h-3 w-3" /> Save &amp; attach
            </Button>
          </div>
        </div>

        {/* Editor + output */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            {/* Line gutter */}
            <div
              ref={gutterRef}
              className="select-none overflow-hidden border-r border-border bg-muted/20 px-2 py-2 text-right font-mono text-[12px] leading-[1.5] text-muted-foreground/50"
              style={{ minWidth: 44 }}
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <div key={i}>{i + 1}</div>
              ))}
            </div>
            <textarea
              ref={taRef}
              value={active.content}
              onChange={(e) => updateActive(e.target.value)}
              onKeyDown={handleKeyDown}
              onScroll={(e) => {
                if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop;
              }}
              spellCheck={false}
              className="min-h-0 flex-1 resize-none bg-background px-3 py-2 font-mono text-[12px] leading-[1.5] text-foreground focus-visible:outline-none"
              placeholder="Write code here…"
            />
          </div>

          {/* Output panel */}
          <div className="h-40 shrink-0 overflow-auto border-t border-border bg-muted/10">
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {output ? (
                output.ok ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-destructive" />
                )
              ) : null}
              Output
            </div>
            <pre className="whitespace-pre-wrap px-3 py-2 font-mono text-[11px] text-muted-foreground">
              {output ? output.text : "Run the file to see output here (⌘/Ctrl+Enter)."}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}
