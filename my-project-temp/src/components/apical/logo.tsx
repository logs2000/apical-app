"use client";

import { cn } from "@/lib/utils";
import { agentAvatarStyle, agentInitials } from "@/lib/apical";

/**
 * Apical mark — a large triangle with a smaller triangle nested inside,
 * evoking the "apex" / growth-tip concept. Derived from the official logo.
 *
 * Uses `currentColor` so it inherits the text color: black on light backgrounds,
 * white on dark backgrounds. No gradient (the official logo is solid black).
 *
 * `withGlow` adds a subtle blurred duplicate behind the mark (used on auth
 * pages + the landing hero) for a soft halo effect.
 */
export function ApicalMark({ className, withGlow = false }: { className?: string; withGlow?: boolean }) {
  return (
    <svg
      viewBox="0 0 180 180"
      fill="none"
      className={cn("h-7 w-7 text-foreground", className)}
      aria-hidden="true"
    >
      {withGlow && (
        <g className="blur-md" opacity={0.3}>
          <polygon points="90,20 160,150 20,150" fill="currentColor" />
          <polygon points="90,70 125,140 55,140" fill="#ffffff" />
          <polygon points="90,95 105,135 75,135" fill="currentColor" />
        </g>
      )}
      {/* Outer triangle (large) */}
      <polygon points="90,20 160,150 20,150" fill="currentColor" />
      {/* Inner triangle (nested, creates the layered apex effect) */}
      <polygon points="90,70 125,140 55,140" fill="#ffffff" />
      {/* Innermost triangle (the apex tip) */}
      <polygon points="90,95 105,135 75,135" fill="currentColor" />
    </svg>
  );
}

export function ApicalWordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ApicalMark className="h-6 w-6" />
      {!compact && (
        <span className="font-semibold tracking-tight text-[14px] lowercase">
          apical
        </span>
      )}
    </div>
  );
}

/** Agent initials circle — HSL colors for Safari 15 / Tauri WebView contrast. */
export function AgentAvatar({
  name,
  className,
  textClassName = "text-[9px] font-semibold",
}: {
  name: string;
  className?: string;
  textClassName?: string;
}) {
  const style = agentAvatarStyle(name);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full",
        className,
      )}
      style={style}
      aria-hidden
    >
      <span className={textClassName}>{agentInitials(name)}</span>
    </div>
  );
}

/** Flagged-item count — solid amber badge readable in Safari 15 dark mode. */
export function FlaggedCountBadge({
  count,
  className,
}: {
  count: number;
  className?: string;
}) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded border border-amber-500/70 bg-amber-500 px-1 py-px text-[8px] font-bold leading-none text-amber-950",
        className,
      )}
    >
      {count}
    </span>
  );
}

export function RuntimeBadge({ runtime }: { runtime: "local" | "hosted" }) {
  const isLocal = runtime === "local";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
        isLocal
          ? "border-border bg-muted text-foreground"
          : "border-border bg-muted text-muted-foreground"
      }`}
      title={
        isLocal
          ? "Runs on your machine (desktop app) — has filesystem, CLI, and network access"
          : "Runs on the Apical server — accessible from anywhere, no direct filesystem access"
      }
    >
      {isLocal ? "Local" : "Hosted"}
    </span>
  );
}
