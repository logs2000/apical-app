"use client";

import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { getCopyableChatText } from "@/lib/apical/chat-copy";
import { useToast } from "@/hooks/use-toast";

export function CopyMessageButton({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  const copy = React.useCallback(async () => {
    const payload = getCopyableChatText(text);
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
      toast({ title: "Copied to clipboard" });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast({ title: "Could not copy", variant: "destructive" });
    }
  }, [text, toast]);

  return (
    <button
      type="button"
      onClick={() => void copy()}
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy message"}
      className={cn(
        "inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground",
        className,
      )}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
