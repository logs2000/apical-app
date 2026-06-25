"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  FolderOpen,
  Paperclip,
  X,
  FileCode2,
  Plus,
  ArrowUp,
  Square,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { IS_TAURI } from "@/lib/desktop/tauri-bridge";
import { pickFiles, formatBytes } from "@/lib/apical/attachments";
import type { ChatAttachment } from "@/lib/apical";

interface ChatComposerProps {
  value: string;
  onChange: (v: string) => void;
  onSend: (payload: { text: string; attachments: ChatAttachment[] }) => void;
  attachments: ChatAttachment[];
  onAttachmentsChange: (next: ChatAttachment[]) => void;
  disabled?: boolean;
  /** True while the agent is actively working — shows a stop button. */
  working?: boolean;
  onStop?: () => void;
  placeholder?: string;
}

function AttachMenu({
  disabled,
  onUpload,
  onFolder,
}: {
  disabled?: boolean;
  onUpload: () => void;
  onFolder: () => void;
}) {
  const [open, setOpen] = React.useState(false);
  const anchorRef = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState({ top: 0, left: 0 });

  const updatePos = React.useCallback(() => {
    if (!anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    setPos({ top: r.top - 6, left: r.left });
  }, []);

  // Position before paint so the menu never flashes at (0,0).
  React.useLayoutEffect(() => {
    if (open) updatePos();
  }, [open, updatePos]);

  React.useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const menu =
    open &&
    typeof document !== "undefined" &&
    createPortal(
      <div
        ref={menuRef}
        role="menu"
        style={{ top: pos.top, left: pos.left, transform: "translateY(-100%)" }}
        className="fixed z-[200] w-44 overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            setOpen(false);
            onUpload();
          }}
        >
          <Paperclip className="h-3.5 w-3.5 shrink-0" />
          Upload file
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-xs hover:bg-accent hover:text-accent-foreground"
          onClick={() => {
            setOpen(false);
            onFolder();
          }}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          {IS_TAURI ? "Select folder" : "Select folder"}
        </button>
      </div>,
      document.body,
    );

  return (
    <div ref={anchorRef} className="relative shrink-0 self-end">
      <button
        type="button"
        disabled={disabled}
        title="Attach"
        aria-expanded={open}
        aria-haspopup="menu"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground disabled:opacity-40"
        onClick={() => {
          updatePos();
          setOpen((o) => !o);
        }}
      >
        <Plus className="h-4 w-4" />
      </button>
      {menu}
    </div>
  );
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  attachments,
  onAttachmentsChange,
  disabled,
  working,
  onStop,
  placeholder,
}: ChatComposerProps) {
  const [busy, setBusy] = React.useState(false);

  async function attachFiles(directory = false) {
    setBusy(true);
    try {
      const picked = await pickFiles({ multiple: true, directory });
      if (picked.length) onAttachmentsChange([...attachments, ...picked]);
    } catch (e) {
      console.error(e);
    } finally {
      setBusy(false);
    }
  }

  function removeAttachment(id: string) {
    onAttachmentsChange(attachments.filter((x) => x.id !== id));
  }

  function submit() {
    if (disabled || busy || working) return;
    const text = value.trim();
    if (!text && attachments.length === 0) return;
    onSend({ text, attachments });
    onChange("");
    onAttachmentsChange([]);
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="shrink-0 border-t border-border bg-background p-3"
    >
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {attachments.map((a) => (
            <span
              key={a.id}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {a.kind === "folder" ? (
                <FolderOpen className="h-3 w-3" />
              ) : a.kind === "code" ? (
                <FileCode2 className="h-3 w-3" />
              ) : (
                <Paperclip className="h-3 w-3" />
              )}
              <span className="max-w-[140px] truncate">{a.name}</span>
              {a.sizeBytes ? <span className="opacity-60">({formatBytes(a.sizeBytes)})</span> : null}
              <button
                type="button"
                className="rounded p-0.5 hover:bg-accent"
                onClick={() => removeAttachment(a.id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <AttachMenu
          disabled={disabled || working}
          onUpload={() => void attachFiles(false)}
          onFolder={() => void attachFiles(true)}
        />
        <Textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !working) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            "min-h-[44px] flex-1 resize-none border border-input bg-background text-sm",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/40",
          )}
        />
        {working ? (
          <button
            type="button"
            onClick={onStop}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-destructive text-destructive-foreground transition hover:opacity-90"
            aria-label="Stop"
          >
            <Square className="h-3.5 w-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="submit"
            disabled={disabled || busy || (!value.trim() && attachments.length === 0)}
            className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground transition hover:opacity-90 disabled:opacity-30"
            aria-label="Send"
          >
            <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
          </button>
        )}
      </div>
    </form>
  );
}
