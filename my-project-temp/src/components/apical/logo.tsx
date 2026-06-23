"use client";

import { cn } from "@/lib/utils";

/** Apical mark — an upward apical meristem / growth tip, doubling as a stylized "A". */
export function ApicalMark({ className, withGlow = false }: { className?: string; withGlow?: boolean }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("h-7 w-7", className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="apicalGrad" x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.62 0.15 158)" />
          <stop offset="1" stopColor="oklch(0.78 0.16 170)" />
        </linearGradient>
      </defs>
      {withGlow && (
        <path
          d="M16 2 L29 28 L22.5 28 L16 14 L9.5 28 L3 28 Z"
          fill="url(#apicalGrad)"
          opacity={0.25}
          className="blur-md"
        />
      )}
      <path d="M16 2 L29 28 L22.5 28 L16 14 L9.5 28 L3 28 Z" fill="url(#apicalGrad)" />
      <circle cx="16" cy="6.5" r="2.1" fill="oklch(0.95 0.05 160)" />
    </svg>
  );
}

export function ApicalWordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ApicalMark className="h-6 w-6" />
      {!compact && (
        <span className="font-semibold tracking-tight text-[14px]">
          Apical<span className="text-primary">.</span>
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
