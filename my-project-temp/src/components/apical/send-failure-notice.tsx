"use client";

import { AlertCircle, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SendFailureNotice({
  message,
  retryable,
  onRetry,
  onDismiss,
  className,
  compact,
}: {
  message: string;
  retryable?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  className?: string;
  /** Smaller padding for composer strip vs in-chat card. */
  compact?: boolean;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 text-destructive",
        compact ? "px-2.5 py-2 text-xs" : "px-3 py-2.5 text-sm",
        className,
      )}
    >
      <AlertCircle className={cn("shrink-0", compact ? "mt-0.5 h-3.5 w-3.5" : "mt-0.5 h-4 w-4")} />
      <div className="min-w-0 flex-1 space-y-1">
        <p className={cn("font-medium text-foreground", compact && "text-xs")}>
          Couldn&apos;t send your message
        </p>
        <p className={cn("text-muted-foreground", compact ? "text-[11px]" : "text-xs")}>{message}</p>
        {retryable && onRetry && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className={cn("mt-1 h-7 gap-1.5", compact && "h-6 text-[11px]")}
            onClick={onRetry}
          >
            <RotateCcw className="h-3 w-3" />
            Retry
          </Button>
        )}
      </div>
      {onDismiss && (
        <button
          type="button"
          className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          aria-label="Dismiss"
          onClick={onDismiss}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
