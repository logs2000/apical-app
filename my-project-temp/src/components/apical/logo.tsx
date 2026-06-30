"use client";

import { cn } from "@/lib/utils";
import { agentAvatarStyle, agentInitials } from "@/lib/apical";

/** Tight bounds around the mark (465×341), origin at top-left of artwork. */
const OUTER = "M231 0 L465 341 L373 341 L231 136 L91 341 L0 341 Z";
const INNER = "M231 249 L293 341 L169 341 Z";
const VIEWBOX_STATIC = "0 0 465 341";
/** Extra bottom room for entrance animation translateY. */
const VIEWBOX_ANIMATED = "0 0 465 375";

/**
 * Apical mark — nested triangles (apex / growth tip). Uses `currentColor` on
 * light backgrounds; animated variant for hero/auth surfaces.
 */
export function ApicalMark({
  className,
  withGlow = false,
  animated = false,
}: {
  className?: string;
  withGlow?: boolean;
  animated?: boolean;
}) {
  if (withGlow || animated) {
    return <ApicalMarkAnimated className={className} />;
  }

  return (
    <svg
      viewBox={VIEWBOX_STATIC}
      fill="none"
      className={cn("h-7 w-7 text-foreground", className)}
      aria-hidden="true"
    >
      <path fill="currentColor" d={OUTER} />
      <path fill="currentColor" d={INNER} />
    </svg>
  );
}

/** Animated mark — plays once on mount (hero, auth pages). */
export function ApicalMarkAnimated({ className }: { className?: string }) {
  return (
    <svg
      viewBox={VIEWBOX_ANIMATED}
      fill="none"
      className={cn("h-7 w-7 text-foreground", className)}
      aria-hidden="true"
    >
      <style>{`
        .apical-logo { transform-box: fill-box; transform-origin: center; animation: apical-settle 900ms cubic-bezier(.16,1,.3,1) both; }
        .apical-outer { opacity: 0; transform-box: fill-box; transform-origin: 50% 100%; animation: apical-outerIn 900ms cubic-bezier(.16,1,.3,1) 80ms forwards; }
        .apical-inner { opacity: 0; transform-box: fill-box; transform-origin: center; animation: apical-innerIn 650ms cubic-bezier(.16,1,.3,1) 520ms forwards; }
        .apical-shine { opacity: 0; transform: translateX(-320px) skewX(-24deg); animation: apical-sweep 900ms ease 1050ms forwards; }
        @keyframes apical-outerIn { 0% { opacity: 0; transform: translateY(34px) scale(.94); } 55% { opacity: 1; } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes apical-innerIn { 0% { opacity: 0; transform: translateY(22px) scale(.76); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        @keyframes apical-settle { 0% { transform: scale(.985); } 100% { transform: scale(1); } }
        @keyframes apical-sweep { 0% { opacity: 0; transform: translateX(-320px) skewX(-24deg); } 18% { opacity: .22; } 65% { opacity: .14; } 100% { opacity: 0; transform: translateX(430px) skewX(-24deg); } }
        @media (prefers-reduced-motion: reduce) {
          .apical-logo, .apical-outer, .apical-inner, .apical-shine { animation: none; opacity: 1; transform: none; }
          .apical-shine { opacity: 0; }
        }
      `}</style>
      <defs>
        <clipPath id="apicalMarkClip">
          <path d={OUTER} />
          <path d={INNER} />
        </clipPath>
      </defs>
      <g className="apical-logo">
        <path className="apical-outer" fill="currentColor" d={OUTER} />
        <path className="apical-inner" fill="currentColor" d={INNER} />
      </g>
      <g clipPath="url(#apicalMarkClip)">
        <rect className="apical-shine" x="99" y="-42" width="72" height="440" fill="currentColor" opacity="0.35" />
      </g>
    </svg>
  );
}

/** Brand wordmark text — Circular Std. */
export function ApicalName({
  className,
  withDot = false,
}: {
  className?: string;
  withDot?: boolean;
}) {
  return (
    <span className={cn("font-circular font-medium tracking-tight", className)}>
      Apical
      {withDot && <span className="text-brand">.</span>}
    </span>
  );
}

export function ApicalWordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ApicalMark className="h-6 w-6" />
      {!compact && <ApicalName className="text-[14px]" />}
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
