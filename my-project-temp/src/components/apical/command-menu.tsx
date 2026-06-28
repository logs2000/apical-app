"use client";

import * as React from "react";
import { useAppStore, type Mode } from "@/lib/apical/store";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Boxes,
  KeyRound,
  Database,
  CreditCard,
  Settings,
  LayoutTemplate,
  Activity,
  Brain,
  PanelRight,
  FileText,
  LifeBuoy,
  Keyboard,
  LogOut,
  Home,
  SquareStack,
} from "lucide-react";

export type NavItem = {
  key: Mode;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Single-char hint appended after the mod key, e.g. "1" → ⌘1. */
  shortcut?: string;
};

/** Primary destinations (also surfaced as tabs in the header). */
export const PRIMARY_NAV: NavItem[] = [
  { key: "agents", label: "Agents", icon: Boxes, shortcut: "1" },
  { key: "vault", label: "Vault", icon: KeyRound, shortcut: "2" },
  { key: "data", label: "Data", icon: Database, shortcut: "3" },
];

/** Secondary destinations (behind the menu / palette). */
export const SECONDARY_NAV: NavItem[] = [
  { key: "settings", label: "Settings", icon: Settings, shortcut: "," },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "memory", label: "Memory", icon: Brain },
];

/** True on Apple platforms — drives whether we show ⌘ or Ctrl. */
export const IS_MAC =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

/** The display label for the primary modifier key. */
export const MOD_LABEL = IS_MAC ? "⌘" : "Ctrl";

/** Format a shortcut for display, e.g. ("1") → "⌘1". */
export function fmtShortcut(key: string): string {
  return `${MOD_LABEL}${key === "," ? "," : key.toUpperCase()}`;
}

// ─── Command palette ────────────────────────────────────────────────────────

export function CommandMenu({
  open,
  onOpenChange,
  onShowShortcuts,
  onOpenDocs,
  onContactSupport,
  onSignOut,
  onGoHome,
  onNewWindow,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onShowShortcuts: () => void;
  onOpenDocs: () => void;
  onContactSupport: () => void;
  onSignOut: () => void;
  /** Provided only on web; omitted in the desktop build (no landing page). */
  onGoHome?: () => void;
  /** Provided only in the desktop build — opens a new native window. */
  onNewWindow?: () => void;
}) {
  const setMode = useAppStore((s) => s.setMode);
  const mode = useAppStore((s) => s.mode);
  const toggleInspector = useAppStore((s) => s.toggleInspector);

  // Run an action then close the palette.
  const run = React.useCallback(
    (fn: () => void) => {
      fn();
      onOpenChange(false);
    },
    [onOpenChange],
  );

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange} className="z-[320] sm:max-w-xl">
      <CommandInput placeholder="Search actions, or jump to a view…" />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>

        <CommandGroup heading="Go to">
          {PRIMARY_NAV.concat(SECONDARY_NAV).map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.key}
                value={`go ${item.label}`}
                onSelect={() => run(() => setMode(item.key))}
              >
                <Icon className="h-4 w-4" />
                <span>{item.label}</span>
                {mode === item.key && (
                  <span className="ml-2 text-[10px] text-foreground">●</span>
                )}
                {item.shortcut && (
                  <CommandShortcut>{fmtShortcut(item.shortcut)}</CommandShortcut>
                )}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="View">
          <CommandItem
            value="toggle inspector panel"
            onSelect={() => run(toggleInspector)}
          >
            <PanelRight className="h-4 w-4" />
            <span>Toggle inspector</span>
            <CommandShortcut>{fmtShortcut("I")}</CommandShortcut>
          </CommandItem>
          {onNewWindow && (
            <CommandItem
              value="new window open"
              onSelect={() => run(onNewWindow)}
            >
              <SquareStack className="h-4 w-4" />
              <span>New window</span>
              <CommandShortcut>{fmtShortcut("N")}</CommandShortcut>
            </CommandItem>
          )}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Help">
          <CommandItem
            value="keyboard shortcuts"
            onSelect={() => run(onShowShortcuts)}
          >
            <Keyboard className="h-4 w-4" />
            <span>Keyboard shortcuts</span>
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
          <CommandItem value="documentation docs" onSelect={() => run(onOpenDocs)}>
            <FileText className="h-4 w-4" />
            <span>Documentation</span>
          </CommandItem>
          <CommandItem
            value="contact support help"
            onSelect={() => run(onContactSupport)}
          >
            <LifeBuoy className="h-4 w-4" />
            <span>Contact support</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Account">
          {onGoHome && (
            <CommandItem value="home landing page" onSelect={() => run(onGoHome)}>
              <Home className="h-4 w-4" />
              <span>Back to home</span>
            </CommandItem>
          )}
          <CommandItem
            value="sign out log out"
            onSelect={() => run(onSignOut)}
            className="text-destructive data-[selected=true]:text-destructive"
          >
            <LogOut className="h-4 w-4" />
            <span>Sign out</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

// ─── Shortcuts cheatsheet ─────────────────────────────────────────────────────

const SHORTCUT_GROUPS: { heading: string; items: { keys: string[]; label: string }[] }[] = [
  {
    heading: "General",
    items: [
      { keys: [MOD_LABEL, "K"], label: "Open command palette" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
    ],
  },
  {
    heading: "Navigate",
    items: [
      { keys: [MOD_LABEL, "1"], label: "Agents" },
      { keys: [MOD_LABEL, "2"], label: "Vault" },
      { keys: [MOD_LABEL, "3"], label: "Data" },
      { keys: [MOD_LABEL, ","], label: "Settings" },
    ],
  },
  {
    heading: "View",
    items: [{ keys: [MOD_LABEL, "I"], label: "Toggle inspector panel" }],
  },
];

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-md border border-border bg-muted px-1.5 text-[11px] font-medium text-foreground shadow-sm">
      {children}
    </kbd>
  );
}

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="z-[320] sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Press {MOD_LABEL}K anytime to open the command palette.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.heading}>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.heading}
              </div>
              <div className="space-y-1">
                {group.items.map((item) => (
                  <div
                    key={item.label}
                    className="flex items-center justify-between rounded-md px-1 py-1 text-sm"
                  >
                    <span className="text-foreground">{item.label}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((k, i) => (
                        <Keycap key={i}>{k}</Keycap>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
