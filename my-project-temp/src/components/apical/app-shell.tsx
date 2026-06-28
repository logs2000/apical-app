"use client";

import * as React from "react";
import { useAppStore } from "@/lib/apical/store";
import { AgentsView } from "./agents-view";
import { VaultTab } from "./vault-tab";
import { DataTab } from "./data-tab";
import { BillingTab } from "./billing-tab";
import { SettingsView } from "./settings-view";
import { TemplatesView } from "./templates-view";
import { ActivityView } from "./activity-view";
import { MemoryView } from "./memory-view";
import {
  CommandMenu,
  ShortcutsDialog,
  PRIMARY_NAV,
  SECONDARY_NAV,
  fmtShortcut,
  MOD_LABEL,
} from "./command-menu";
import {
  IS_TAURI,
  onMenuAction,
  openAppWindow,
  type MenuAction,
} from "@/lib/desktop/tauri-bridge";
import { cn } from "@/lib/utils";
import { ModeToggle } from "@/components/mode-toggle";
import {
  ArrowLeft,
  MoreHorizontal,
  HelpCircle,
  FileText,
  Keyboard,
  LifeBuoy,
  LogOut,
  Search,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { ApicalWordmark } from "@/components/apical/logo";
import { useAuth } from "@/components/auth/AuthDialog";

const openDocs = () => window.open("/docs", "_blank");
const contactSupport = () => window.open("mailto:hello@apic.al", "_blank");

export function AppShell({ user }: { user: { email: string; name: string } | null }) {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const toggleInspector = useAppStore((s) => s.toggleInspector);
  const setActiveConversation = useAppStore((s) => s.setActiveConversation);
  const setPopoutConversation = useAppStore((s) => s.setPopoutConversation);
  const { signOut, closeApp } = useAuth();

  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [shortcutsOpen, setShortcutsOpen] = React.useState(false);

  // Deep link: a popped-out window opens with "/#popout=<conversationId>".
  // Read it once on mount and focus that conversation (this window becomes a
  // single-agent "pop-out" — the navigator rail is hidden). Also supports the
  // "?popout=" query form as a fallback.
  React.useEffect(() => {
    const fromHash = window.location.hash.match(/popout=([^&]+)/);
    const id = fromHash
      ? decodeURIComponent(fromHash[1])
      : new URLSearchParams(window.location.search).get("popout");
    if (id) {
      setPopoutConversation(id);
      setActiveConversation(id);
      setMode("agents");
    }
  }, [setActiveConversation, setPopoutConversation, setMode]);

  const isMenuView = SECONDARY_NAV.some((m) => m.key === mode);
  const activeMenuView = SECONDARY_NAV.find((m) => m.key === mode);

  // Global keyboard shortcuts. The palette toggle works even while typing;
  // everything else is suppressed when focus is in a text field so we never
  // hijack normal typing.
  //
  // In the desktop build the native menu bar owns these accelerators (so the
  // OS menu and our handler can't double-fire), so we skip registering here.
  React.useEffect(() => {
    if (IS_TAURI) return;
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const target = e.target as HTMLElement | null;
      const typing =
        !!target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (typing) return;

      if (mod && e.key === "1") {
        e.preventDefault();
        setMode("agents");
      } else if (mod && e.key === "2") {
        e.preventDefault();
        setMode("vault");
      } else if (mod && e.key === "3") {
        e.preventDefault();
        setMode("data");
      } else if (mod && e.key === ",") {
        e.preventDefault();
        setMode("settings");
      } else if (mod && e.key.toLowerCase() === "i") {
        e.preventDefault();
        toggleInspector();
      } else if (!mod && e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [setMode, toggleInspector]);

  // Desktop only: respond to native menu-bar / tray actions forwarded from Rust.
  React.useEffect(() => {
    if (!IS_TAURI) return;
    let unlisten: (() => void) | null = null;
    let active = true;
    onMenuAction((action: MenuAction) => {
      switch (action) {
        case "nav:agents":
          setMode("agents");
          break;
        case "nav:vault":
          setMode("vault");
          break;
        case "nav:data":
          setMode("data");
          break;
        case "nav:settings":
          setMode("settings");
          break;
        case "view:inspector":
          toggleInspector();
          break;
        case "view:palette":
          setPaletteOpen(true);
          break;
        case "help:docs":
          openDocs();
          break;
        case "help:shortcuts":
          setShortcutsOpen(true);
          break;
      }
    }).then((u) => {
      // If the component unmounted before the listener resolved, detach now.
      if (active) unlisten = u;
      else u?.();
    });
    return () => {
      active = false;
      unlisten?.();
    };
  }, [setMode, toggleInspector]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Top header bar — tabs at the top */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md md:px-4">
        {!IS_TAURI && !isMenuView && (
          <ApicalWordmark className="mr-1 hidden shrink-0 sm:flex" />
        )}
        {isMenuView ? (
          <button
            onClick={() => setMode("agents")}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Back to app</span>
          </button>
        ) : (
          <div className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/40 p-0.5">
            {PRIMARY_NAV.map((t) => {
              const active = mode === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setMode(t.key)}
                  title={t.shortcut ? `${t.label} (${fmtShortcut(t.shortcut)})` : t.label}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
                    active
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" /> {t.label}
                </button>
              );
            })}
          </div>
        )}

        <div className="ml-auto flex items-center gap-1">
          {/* Command palette trigger — the primary "find anything" affordance. */}
          <button
            onClick={() => setPaletteOpen(true)}
            title={`Search & commands (${MOD_LABEL}K)`}
            className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Search className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Search</span>
            <kbd className="hidden items-center rounded border border-border bg-background px-1 text-[10px] font-medium md:inline-flex">
              {MOD_LABEL}K
            </kbd>
          </button>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                title="Menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[300] w-56">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Menu
              </DropdownMenuLabel>
              {SECONDARY_NAV.map((m) => {
                const Icon = m.icon;
                return (
                  <DropdownMenuItem
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className="gap-2 text-xs"
                  >
                    <Icon className="h-3.5 w-3.5" /> {m.label}
                    {m.shortcut && (
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        {fmtShortcut(m.shortcut)}
                      </span>
                    )}
                    {mode === m.key && !m.shortcut && (
                      <span className="ml-auto text-[10px] text-foreground">●</span>
                    )}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-xs" onClick={openDocs}>
                <FileText className="h-3.5 w-3.5" /> Docs
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 text-xs"
                onClick={() => setShortcutsOpen(true)}
              >
                <HelpCircle className="h-3.5 w-3.5" /> Help &amp; shortcuts
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-xs" onClick={contactSupport}>
                <LifeBuoy className="h-3.5 w-3.5" /> Contact support
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-xs text-muted-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-foreground">
                  {user?.name?.[0]?.toUpperCase() ?? "D"}
                </span>
                <span className="min-w-0 flex-1 truncate">{user?.email ?? "dev@apical.local"}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 text-xs"
                onClick={() => setShortcutsOpen(true)}
              >
                <Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts
                <span className="ml-auto text-[10px] text-muted-foreground">?</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 text-xs text-destructive"
                onClick={signOut}
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ModeToggle />
        </div>
      </header>

      {/* If we're on a menu view, show its title as a sub-header so the user knows where they are */}
      {isMenuView && activeMenuView && (
        <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-muted/30 px-4 text-xs">
          <activeMenuView.icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="font-medium">{activeMenuView.label}</span>
        </div>
      )}

      {/* Main content area */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {mode === "agents" && <AgentsView />}
        {mode === "vault" && <VaultTab />}
        {mode === "data" && <DataTab />}
        {mode === "billing" && <BillingTab />}
        {mode === "settings" && <SettingsView />}
        {mode === "templates" && <TemplatesView />}
        {mode === "activity" && <ActivityView />}
        {mode === "memory" && <MemoryView />}
      </main>

      {/* Footer status bar */}
      <footer className="shrink-0 border-t border-border bg-background/80 px-3 py-1 backdrop-blur-md md:px-4">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground" /> Agent running
          </span>
          <span className="hidden sm:inline">Apical — Consider it Done.</span>
          <span>Local runtime</span>
        </div>
      </footer>

      {/* Command palette + shortcuts cheatsheet (global) */}
      <CommandMenu
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowShortcuts={() => setShortcutsOpen(true)}
        onOpenDocs={openDocs}
        onContactSupport={contactSupport}
        onSignOut={signOut}
        onGoHome={IS_TAURI ? undefined : closeApp}
        onNewWindow={IS_TAURI ? () => void openAppWindow() : undefined}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </div>
  );
}
