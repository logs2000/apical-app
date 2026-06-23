'use client'

import * as React from 'react'
import { useAppStore, type Mode } from '@/lib/store'
import { ApicalWordmark } from './logo'
import { ThemeToggle } from './theme-toggle'
import { ChatTab } from './chat-tab'
import { AgentsTab } from './agents-tab'
import { SettingsView, TokensSection } from './settings-view'
import { ModelsSection } from './models-section'
import { DataSection } from './data-section'
import { BillingSection } from './billing-section'
import { OAuthConnect } from './oauth-connect'
import { DesktopBridgePanel } from './desktop-bridge-panel'
import { cn } from '@/lib/utils'
import { ArrowLeft, MessageSquare, Boxes, KeyRound, Settings, Database, CreditCard, Cpu, Monitor, PlugZap, LogOut, MoreHorizontal, Home } from 'lucide-react'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel,
} from '@/components/ui/dropdown-menu'
import { useSession, signOut } from 'next-auth/react'
import { clearLandingSeen } from '@/components/landing/os-detect'

// Main tabs in the top bar. Chat + Agents are primary; Vault / Data / Billing
// are the relocated "power" panels (previously buried in settings or the
// removed developer console). Settings is a back-button view for the
// remaining personal prefs (profile, appearance, agent naming, account).
const TABS: { key: Mode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'agents', label: 'Agents', icon: Boxes },
  { key: 'vault', label: 'Vault', icon: KeyRound },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'billing', label: 'Billing', icon: CreditCard },
]

export function AppShell() {
  const mode = useAppStore((s) => s.mode)
  const setMode = useAppStore((s) => s.setMode)
  const { data: session } = useSession()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])

  const isSettings = mode === 'settings'

  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md md:px-4">
        <ApicalWordmark className="mr-2" />
        {!isSettings && (
          <div className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/40 p-0.5">
            {TABS.map((t) => {
              const active = mode === t.key
              const Icon = t.icon
              return (
                <button key={t.key} onClick={() => setMode(t.key)}
                  className={cn('flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                    active ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
                  <Icon className="h-3.5 w-3.5" /> {t.label}
                </button>
              )
            })}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {isSettings ? (
            <button onClick={() => setMode('chat')} className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground">
              <ArrowLeft className="h-3.5 w-3.5" /><span className="hidden sm:inline">Back to app</span>
            </button>
          ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-1 rounded-md p-1.5 text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Menu">
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wide text-muted-foreground">Menu</DropdownMenuLabel>
                <DropdownMenuItem onClick={() => setMode('settings')} className="gap-2 text-xs">
                  <Settings className="h-3.5 w-3.5" /> Settings
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="gap-2 text-xs text-muted-foreground">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                    {mounted && session?.user?.name ? session.user.name[0].toUpperCase() : 'D'}
                  </span>
                  {mounted && session?.user?.email ? session.user.email : 'dev@apical.local'}
                </DropdownMenuItem>
                {mounted && session && (
                  <DropdownMenuItem className="gap-2 text-xs text-destructive" onClick={() => signOut({ callbackUrl: '/login' })}>
                    <LogOut className="h-3.5 w-3.5" /> Sign out
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          <button
            onClick={() => { clearLandingSeen(); window.location.reload() }}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            title="Back to landing page"
          >
            <Home className="h-3.5 w-3.5" /><span className="hidden sm:inline">Home</span>
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="min-h-0 flex-1 overflow-hidden">
        {mode === 'chat' && <ChatTab />}
        {mode === 'agents' && <AgentsTab />}
        {mode === 'vault' && <VaultTab />}
        {mode === 'data' && <DataTab />}
        {mode === 'billing' && <BillingTab />}
        {mode === 'settings' && <SettingsView />}
      </main>

      <footer className="shrink-0 border-t border-border bg-background/80 px-3 py-1 backdrop-blur-md md:px-4">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Agent running</span>
          <span className="hidden sm:inline">Apical — Consider it Done.</span>
          <span>Local runtime</span>
        </div>
      </footer>
    </div>
  )
}

// ---------------- Vault tab ----------------
// The vault is the home for keys + connections + models + desktop — everything
// the agent uses to reach the outside world. Previously buried in settings +
// the removed developer console.
function VaultTab() {
  const [section, setSection] = React.useState<'tokens' | 'connections' | 'models' | 'desktop'>('models')
  const sections = [
    { key: 'models' as const, label: 'Models', icon: Cpu, desc: 'AI models + your API keys' },
    { key: 'connections' as const, label: 'Connections', icon: PlugZap, desc: 'Gmail, Slack, Stripe, Notion…' },
    { key: 'tokens' as const, label: 'Access tokens', icon: KeyRound, desc: 'API tokens for MCP / REST' },
    { key: 'desktop' as const, label: 'Desktop', icon: Monitor, desc: 'Let agents read your files + run commands' },
  ]
  return (
    <div className="flex h-full overflow-hidden">
      <nav className="hidden md:flex w-48 shrink-0 flex-col gap-0.5 border-r border-border p-2">
        {sections.map((s) => (
          <button key={s.key} onClick={() => setSection(s.key)}
            className={cn('flex flex-col items-start gap-0.5 rounded-lg px-2.5 py-1.5 text-xs transition-colors',
              section === s.key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
            <span className="flex items-center gap-2 font-medium"><s.icon className="h-3.5 w-3.5" /> {s.label}</span>
            <span className="pl-5 text-[10px] text-muted-foreground">{s.desc}</span>
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
          {/* Mobile section picker */}
          <div className="mb-4 flex gap-1 overflow-x-auto md:hidden">
            {sections.map((s) => (
              <button key={s.key} onClick={() => setSection(s.key)}
                className={cn('flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium',
                  section === s.key ? 'bg-primary/10 text-foreground' : 'text-muted-foreground')}>
                <s.icon className="h-3 w-3" /> {s.label}
              </button>
            ))}
          </div>
          {section === 'models' && <ModelsSection />}
          {section === 'connections' && <OAuthConnect />}
          {section === 'tokens' && <TokensSectionWrapper />}
          {section === 'desktop' && <DesktopBridgePanel />}
        </div>
      </div>
    </div>
  )
}

// ---------------- Data tab ----------------
function DataTab() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 py-5 md:px-6">
        <DataSection />
      </div>
    </div>
  )
}

// ---------------- Billing tab ----------------
function BillingTab() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
        <BillingSection />
      </div>
    </div>
  )
}

// ---------------- Tokens section (moved from settings) ----------------
// Reuses the TokensSection from settings-view so the vault tab shows the
// same access-token management UI.
function TokensSectionWrapper() {
  return <TokensSection />
}
