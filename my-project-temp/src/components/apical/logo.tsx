"use client";

import { cn } from "@/lib/utils";
import { agentAvatarStyle, agentInitials } from "@/lib/apical";

/** Logo artwork bounds (465×341) with padding so edges are not clipped. */
const OUTER = "M231 0 L465 341 L373 341 L231 136 L91 341 L0 341 Z";
const INNER = "M231 249 L293 341 L169 341 Z";
const VIEWBOX_STATIC = "-14 -10 493 361";
const VIEWBOX_ANIMATED = "-14 -10 493 395";

const markClass = (aspect: string, className?: string) =>
  cn(`h-7 w-auto shrink-0 aspect-[${aspect}] text-foreground`, className);

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
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
      className={markClass("465/341", className)}
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
      preserveAspectRatio="xMidYMid meet"
      overflow="visible"
      className={markClass("465/375", className)}
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
    <span className={cn("font-circular text-lg font-medium tracking-tight md:text-xl", className)}>
      Apical
      {withDot && <span className="text-brand">.</span>}
    </span>
  );
}

export function ApicalWordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ApicalMark className="h-6" />
      {!compact && <ApicalName />}
    </div>
  );
}

/** Agent initials circle — light gray fill, dark text for consistent contrast. */
export function AgentAvatar({
  name,
  className,
  textClassName = "text-[9px] font-semibold text-neutral-900",
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
      style={{ backgroundColor: style.backgroundColor }}
      aria-hidden
    >
      <span className={textClassName} style={{ color: style.color }}>
        {agentInitials(name)}
      </span>
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

// (RuntimeBadge was removed: runtime is derived from the workflow's steps and
// explained in plain language where it matters — the agent Config tab and the
// inspector status card — instead of a jargon badge on every header.)
