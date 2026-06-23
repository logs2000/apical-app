"use client";

import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { motion, useDragControls } from "framer-motion";
import { Minus, Square, X } from "lucide-react";

// ─── Desktop stage ──────────────────────────────────────────────────────────
//
// The simulated desktop the landing page renders inside. A draggable window
// sits centered on a mountain-wallpaper backdrop. The window uses dull-gray
// "traffic light" buttons (not the loud red/yellow/green macOS colors) so it
// reads as a calm, neutral UI affordance rather than a screenshot of macOS.
// Borders are dark-mode aware: light zinc on the light theme, soft white/10
// on the dark theme.

type StageCtx = {
  containerRef: RefObject<HTMLDivElement | null>;
  bringToFront: () => number;
};

const Ctx = createContext<StageCtx | null>(null);

export function useDesktopStage() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useDesktopStage must be used inside <DesktopStage>");
  return c;
}

export function DesktopStage({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [topZ, setTopZ] = useState(10);

  return (
    <Ctx.Provider
      value={{
        containerRef: ref,
        bringToFront: () => {
          const next = topZ + 1;
          setTopZ(next);
          return next;
        },
      }}
    >
      <div
        ref={ref}
        className="relative h-[640px] w-full overflow-hidden rounded-2xl border border-black/10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] dark:border-white/10 dark:shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] sm:h-[600px]"
      >
        {/* Mountain wallpaper — z-0 so it sits above the page background but below the window */}
        <div
          aria-hidden
          className="absolute inset-0 z-0 bg-cover bg-center"
          style={{ backgroundImage: "url('/wallpaper/mountains.jpg')" }}
        />
        {/* Subtle vignette so the window reads against the photo */}
        <div
          aria-hidden
          className="absolute inset-0 z-0"
          style={{
            background:
              "radial-gradient(80% 60% at 50% 50%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.25) 100%)",
          }}
        />

        {/*
          Children (windows) render above the wallpaper.
          The wrapper is a flex container so a single window naturally centers
          horizontally AND vertically. Dragging still works because framer-motion
          applies transforms relative to the centered position.
        */}
        <div className="relative z-10 flex h-full w-full items-center justify-center">
          {children}
        </div>
      </div>
    </Ctx.Provider>
  );
}

// ─── Draggable window (no title text — just traffic lights) ─────────────────
//
// The window is positioned by the parent's flex centering (NOT absolute). The
// `initialX`/`initialY` props now act as offsets from the centered position —
// useful for stacking multiple windows. The default (0,0) leaves the window
// dead-center on the desktop, which is what the landing page wants.

type WindowProps = {
  /** Horizontal offset (px) from the centered position. Default 0. */
  initialX?: number;
  /** Vertical offset (px) from the centered position. Default 0. */
  initialY?: number;
  children: ReactNode;
  width?: number;
  height?: number;
};

export function DraggableWindow({
  initialX = 0,
  initialY = 0,
  children,
  width = 940,
  height = 540,
}: WindowProps) {
  const { containerRef, bringToFront } = useDesktopStage();
  const dragControls = useDragControls();
  const [z, setZ] = useState(10);

  return (
    <motion.div
      drag
      dragListener={false}
      dragControls={dragControls}
      dragMomentum={false}
      dragConstraints={containerRef}
      dragElastic={0}
      initial={{ x: initialX, y: initialY, opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 22 }}
      onPointerDown={() => setZ(bringToFront())}
      style={{ zIndex: z, width, height, maxWidth: "calc(100% - 24px)", maxHeight: "calc(100% - 24px)" }}
      className="relative select-none"
    >
      <div className="flex h-full w-full flex-col overflow-hidden rounded-xl border border-black/10 bg-zinc-50 shadow-[0_25px_60px_-15px_rgba(0,0,0,0.55)] dark:border-white/10 dark:bg-zinc-900 dark:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.8)]">
        {/* Title bar — drag handle, traffic lights only, no title text */}
        <div
          onPointerDown={(e) => dragControls.start(e)}
          className="flex h-9 shrink-0 cursor-grab items-center gap-2 border-b border-zinc-200 bg-zinc-100 px-3 active:cursor-grabbing dark:border-white/10 dark:bg-zinc-800/80"
        >
          <div className="flex items-center gap-2">
            {/*
              Dull-gray "traffic light" buttons. We intentionally avoid the loud
              macOS red/yellow/green so the window reads as a neutral UI mock
              rather than a macOS screenshot. Hover reveals the close/min/max
              glyph in a slightly darker gray for affordance.
            */}
            <button
              onPointerDown={(e) => e.stopPropagation()}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-zinc-400 text-black/50 hover:bg-zinc-500 dark:bg-zinc-600 dark:hover:bg-zinc-500"
              aria-label="Close"
            >
              <X className="h-2 w-2 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-zinc-400 text-black/50 hover:bg-zinc-500 dark:bg-zinc-600 dark:hover:bg-zinc-500"
              aria-label="Minimize"
            >
              <Minus className="h-2 w-2 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
            <button
              onPointerDown={(e) => e.stopPropagation()}
              className="group flex h-3 w-3 items-center justify-center rounded-full bg-zinc-400 text-black/50 hover:bg-zinc-500 dark:bg-zinc-600 dark:hover:bg-zinc-500"
              aria-label="Maximize"
            >
              <Square className="h-2 w-2 opacity-0 group-hover:opacity-100" strokeWidth={3} />
            </button>
          </div>
          {/* No title text — window is untitled by request */}
          <div className="flex-1" />
        </div>

        {/* Body */}
        <div className="relative flex-1 overflow-hidden bg-background">{children}</div>
      </div>
    </motion.div>
  );
}
