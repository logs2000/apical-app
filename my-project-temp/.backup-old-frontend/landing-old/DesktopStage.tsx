"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

// ---------------------------------------------------------------------------
// Context – shares the stage container ref so DraggableWindow can constrain
// its drag area to the DesktopStage bounds.
// ---------------------------------------------------------------------------

const StageRefContext = React.createContext<React.RefObject<HTMLDivElement | null>>(
  { current: null }
);

// ---------------------------------------------------------------------------
// DesktopStage – subtle dot-grid background container
// ---------------------------------------------------------------------------

export function DesktopStage({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null);

  return (
    <StageRefContext.Provider value={ref}>
      <div
        ref={ref}
        className={cn(
          "relative w-full overflow-hidden rounded-xl border border-border",
          "bg-muted/40"
        )}
        style={
          {
            backgroundImage:
              "radial-gradient(circle, color-mix(in oklch, var(--muted-foreground) 20%, transparent) 1px, transparent 1px)",
            backgroundSize: "20px 20px",
          } as React.CSSProperties
        }
      >
        {children}
      </div>
    </StageRefContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// DraggableWindow – macOS-style draggable window (pure JS drag, no framer)
// ---------------------------------------------------------------------------

export interface DraggableWindowProps {
  /** Initial horizontal offset (px) inside the DesktopStage */
  initialX: number;
  /** Initial vertical offset (px) inside the DesktopStage */
  initialY: number;
  /** Window width (px) */
  width: number;
  /** Window height (px) */
  height: number;
  children: React.ReactNode;
}

export function DraggableWindow({
  initialX,
  initialY,
  width,
  height,
  children,
}: DraggableWindowProps) {
  const isMobile = useIsMobile();
  const stageRef = React.useContext(StageRefContext);

  const [pos, setPos] = React.useState({ x: initialX, y: initialY });
  const [mounted, setMounted] = React.useState(false);
  const [hovering, setHovering] = React.useState(false);
  const draggingRef = React.useRef(false);
  const offsetRef = React.useRef({ x: 0, y: 0 });

  // Animate in on mount
  React.useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);

  // ── Drag handlers ───────────────────────────────────────────────────────

  const handlePointerDown = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      // Only drag from the title bar
      if ((e.target as HTMLElement).closest("[data-drag-handle]") === null) return;

      draggingRef.current = true;
      offsetRef.current = {
        x: e.clientX - pos.x,
        y: e.clientY - pos.y,
      };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      document.body.style.userSelect = "none";
    },
    [pos],
  );

  const handlePointerMove = React.useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!draggingRef.current) return;

      const stage = stageRef.current;
      let newX = e.clientX - offsetRef.current.x;
      let newY = e.clientY - offsetRef.current.y;

      // Constrain within stage bounds
      if (stage) {
        const rect = stage.getBoundingClientRect();
        newX = Math.max(0, Math.min(newX, rect.width - width));
        newY = Math.max(0, Math.min(newY, rect.height - height));
      }

      setPos({ x: newX, y: newY });
    },
    [stageRef, width, height],
  );

  const handlePointerUp = React.useCallback(() => {
    draggingRef.current = false;
    document.body.style.userSelect = "";
  }, []);

  // ── Mobile: centered, non-draggable card ──────────────────────────────
  if (isMobile) {
    return (
      <div className="flex items-center justify-center p-4">
        <div
          className="w-full overflow-hidden rounded-xl border border-border bg-card shadow-lg"
          style={{ maxWidth: width }}
        >
          <WindowTitleBar />
          <div className="p-4">{children}</div>
        </div>
      </div>
    );
  }

  // ── Desktop: absolutely positioned, draggable window ──────────────────
  return (
    <div
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className={cn(
        "absolute cursor-default overflow-hidden rounded-xl border border-border bg-card",
        "transition-shadow duration-200",
        hovering
          ? "shadow-[0_25px_50px_-12px_oklch(0_0_0/0.15)]"
          : "shadow-2xl",
      )}
      style={{
        width,
        height,
        left: pos.x,
        top: pos.y,
        opacity: mounted ? 1 : 0,
        transform: mounted ? "scale(1)" : "scale(0.96)",
        transition: mounted
          ? "opacity 0.3s ease-out, transform 0.3s ease-out, box-shadow 0.2s ease-out"
          : "none",
      }}
    >
      {/* Drag handle – the title bar */}
      <div
        data-drag-handle
        className={cn(
          "flex items-center gap-2 border-b border-border px-4 py-2.5",
          "bg-card select-none cursor-grab active:cursor-grabbing",
          "transition-colors duration-150 hover:bg-muted/60"
        )}
      >
        <WindowTitleBar />
      </div>

      {/* Window body */}
      <div className="h-[calc(100%-42px)] overflow-auto p-4">{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// WindowTitleBar – traffic-light dots (macOS style)
// ---------------------------------------------------------------------------

function WindowTitleBar() {
  return (
    <div className="flex items-center gap-1.5">
      {/* Red – close */}
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full",
          "bg-[oklch(0.62_0.22_25)]",
          "shadow-[0_0_0_0.5px_oklch(0_0_0/0.12)]",
          "transition-transform duration-150 hover:scale-110"
        )}
        aria-hidden
      />
      {/* Yellow – minimize */}
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full",
          "bg-[oklch(0.78_0.16_85)]",
          "shadow-[0_0_0_0.5px_oklch(0_0_0/0.12)]",
          "transition-transform duration-150 hover:scale-110"
        )}
        aria-hidden
      />
      {/* Green – zoom – uses the project's primary green token */}
      <span
        className={cn(
          "inline-block h-3 w-3 rounded-full",
          "bg-primary",
          "shadow-[0_0_0_0.5px_oklch(0_0_0/0.12)]",
          "transition-transform duration-150 hover:scale-110"
        )}
        aria-hidden
      />
    </div>
  );
}
