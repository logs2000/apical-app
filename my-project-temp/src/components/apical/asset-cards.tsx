"use client";

import * as React from "react";
import { Download, FileText, FolderOpen, ImageIcon, Code2, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBytes } from "@/lib/apical/attachments";
import type { ChatAttachment } from "@/lib/apical";

const EDITABLE_MIME = /^(text\/|application\/(json|javascript|xml|x-sh)|application\/x-python)/;

function isEditable(a: ChatAttachment): boolean {
  if (a.kind === "folder") return false;
  if (a.kind === "code") return true;
  return EDITABLE_MIME.test(a.mimeType);
}

export function AssetCards({
  attachments,
  className,
  onEdit,
}: {
  attachments: ChatAttachment[];
  className?: string;
  onEdit?: (a: ChatAttachment) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className={cn("mt-2 flex flex-wrap gap-2", className)}>
      {attachments.map((a) => (
        <AssetCard key={a.id} attachment={a} onEdit={onEdit} />
      ))}
    </div>
  );
}

function AssetCard({
  attachment: a,
  onEdit,
}: {
  attachment: ChatAttachment;
  onEdit?: (a: ChatAttachment) => void;
}) {
  const isImage = a.kind === "image" || a.mimeType.startsWith("image/");
  const Icon =
    a.kind === "folder" ? FolderOpen : a.kind === "code" ? Code2 : isImage ? ImageIcon : FileText;
  const canEdit = !!onEdit && isEditable(a);

  return (
    <div className="group relative overflow-hidden rounded-md border border-border bg-muted/30 text-xs max-w-[220px]">
      {isImage && a.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a.url}
          alt={a.name}
          className="h-28 w-full object-cover border-b border-border"
        />
      ) : (
        <div className="flex h-16 items-center justify-center border-b border-border bg-muted/50">
          <Icon className="h-8 w-8 text-muted-foreground/60" />
        </div>
      )}
      <div className="p-2">
        <div className="truncate font-medium text-foreground">{a.name}</div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span>{a.kind}{a.sizeBytes ? ` · ${formatBytes(a.sizeBytes)}` : ""}</span>
          <span className="flex items-center gap-2">
            {canEdit && (
              <button
                type="button"
                onClick={() => onEdit?.(a)}
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="h-3 w-3" /> Edit
              </button>
            )}
            {a.kind !== "folder" && a.url ? (
              <a
                href={a.url}
                download={a.name}
                className="inline-flex items-center gap-0.5 text-primary hover:underline"
              >
                <Download className="h-3 w-3" /> Save
              </a>
            ) : a.localPath ? (
              <span className="truncate max-w-[100px]" title={a.localPath}>
                {a.localPath}
              </span>
            ) : null}
          </span>
        </div>
      </div>
    </div>
  );
}
