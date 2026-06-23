"use client";

import { cn } from "@/lib/utils";

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
          <polygon points="90,70 125,140 55,140" fill="oklch(0.99 0 0)" />
          <polygon points="90,95 105,135 75,135" fill="currentColor" />
        </g>
      )}
      {/* Outer triangle (large) */}
      <polygon points="90,20 160,150 20,150" fill="currentColor" />
      {/* Inner triangle (nested, creates the layered apex effect) */}
      <polygon points="90,70 125,140 55,140" fill="oklch(0.99 0 0)" />
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

export function RuntimeBadge({ runtime }: { runtime: "local" | "hosted" }) {
  const isLocal = runtime === "local";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium ${
        isLocal
          ? "border-primary/30 bg-primary/10 text-primary"
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
