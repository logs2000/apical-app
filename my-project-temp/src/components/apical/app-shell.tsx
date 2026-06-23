"use client";

import * as React from "react";
import { useAppStore, type Mode } from "@/lib/apical/store";
import { ApicalWordmark } from "./logo";
import { ChatTab } from "./chat-tab";
import { AgentsTab } from "./agents-tab";
import { VaultTab } from "./vault-tab";
import { DataTab } from "./data-tab";
import { BillingTab } from "./billing-tab";
import { SettingsView } from "./settings-view";
import { TemplatesView } from "./templates-view";
import { ActivityView } from "./activity-view";
import { MemoryView } from "./memory-view";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  MessageSquare,
  Boxes,
  KeyRound,
  Settings,
  Database,
  CreditCard,
  LogOut,
  MoreHorizontal,
  Home,
  HelpCircle,
  FileText,
  Keyboard,
  LifeBuoy,
  LayoutTemplate,
  Activity,
  Brain,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/auth/AuthDialog";

/** Primary tabs always visible in the top bar. */
const TABS: { key: Mode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "chat", label: "Chat", icon: MessageSquare },
  { key: "agents", label: "Agents", icon: Boxes },
  { key: "vault", label: "Vault", icon: KeyRound },
  { key: "data", label: "Data", icon: Database },
];

/** Views that live behind the "..." menu button (not primary tabs). */
const MENU_VIEWS: { key: Mode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: "settings", label: "Settings", icon: Settings },
  { key: "billing", label: "Billing", icon: CreditCard },
  { key: "templates", label: "Templates", icon: LayoutTemplate },
  { key: "activity", label: "Activity", icon: Activity },
  { key: "memory", label: "Memory", icon: Brain },
];

export function AppShell({ user }: { user: { email: string; name: string } | null }) {
  const mode = useAppStore((s) => s.mode);
  const setMode = useAppStore((s) => s.setMode);
  const { signOut, closeApp } = useAuth();
  // Settings and Billing are both "menu views" — show back button instead of tabs.
  const isMenuView = MENU_VIEWS.some((m) => m.key === mode);
  const activeMenuView = MENU_VIEWS.find((m) => m.key === mode);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {/* Top header bar — tabs at the top */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md md:px-4">
        <ApicalWordmark className="mr-2" />

        {isMenuView ? (
          <button
            onClick={() => setMode("chat")}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Back to app</span>
          </button>
        ) : (
          <div className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/40 p-0.5">
            {TABS.map((t) => {
              const active = mode === t.key;
              const Icon = t.icon;
              return (
                <button
                  key={t.key}
                  onClick={() => setMode(t.key)}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                title="Menu"
              >
                <MoreHorizontal className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="z-[300] w-56">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Menu
              </DropdownMenuLabel>
              {MENU_VIEWS.map((m) => {
                const Icon = m.icon;
                return (
                  <DropdownMenuItem
                    key={m.key}
                    onClick={() => setMode(m.key)}
                    className="gap-2 text-xs"
                  >
                    <Icon className="h-3.5 w-3.5" /> {m.label}
                    {mode === m.key && <span className="ml-auto text-[10px] text-primary">●</span>}
                  </DropdownMenuItem>
                );
              })}
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-xs" onClick={() => window.open("/docs", "_blank")}>
                <FileText className="h-3.5 w-3.5" /> Docs
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-xs" onClick={() => window.open("/docs", "_blank")}>
                <HelpCircle className="h-3.5 w-3.5" /> Help &amp; shortcuts
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-xs" onClick={() => window.open("mailto:hello@apical.dev", "_blank")}>
                <LifeBuoy className="h-3.5 w-3.5" /> Contact support
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="gap-2 text-xs text-muted-foreground">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                  {user?.name?.[0]?.toUpperCase() ?? "D"}
                </span>
                <span className="min-w-0 flex-1 truncate">{user?.email ?? "dev@apical.local"}</span>
              </DropdownMenuItem>
              <DropdownMenuItem className="gap-2 text-xs text-muted-foreground">
                <Keyboard className="h-3.5 w-3.5" /> Keyboard shortcuts
              </DropdownMenuItem>
              <DropdownMenuItem
                className="gap-2 text-xs text-destructive"
                onClick={signOut}
              >
                <LogOut className="h-3.5 w-3.5" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            onClick={closeApp}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            title="Back to landing page"
          >
            <Home className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Home</span>
          </button>
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
        {mode === "chat" && <ChatTab />}
        {mode === "agents" && <AgentsTab />}
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
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Agent running
          </span>
          <span className="hidden sm:inline">Apical — Consider it Done.</span>
          <span>Local runtime</span>
        </div>
      </footer>
    </div>
  );
}
