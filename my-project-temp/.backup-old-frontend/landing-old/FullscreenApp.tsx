'use client'

import * as React from 'react'
import { ApicalMark } from '@/components/demo-app/DemoApp'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  MessageSquare,
  Boxes,
  KeyRound,
  Database,
  CreditCard,
  Home,
  Send,
  ArrowLeft,
  Bot,
  User,
  Sparkles,
  ShieldCheck,
  Zap,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AppTab = 'chat' | 'agents' | 'vault' | 'data' | 'billing'

interface TabDef {
  key: AppTab
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const TABS: TabDef[] = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'agents', label: 'Agents', icon: Boxes },
  { key: 'vault', label: 'Vault', icon: KeyRound },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'billing', label: 'Billing', icon: CreditCard },
]

// ---------------------------------------------------------------------------
// Session-storage key (the landing page writes this when the user clicks
// "Open the web app", but we also support listening for a custom event).
// ---------------------------------------------------------------------------

const SESSION_KEY = 'apical_landing_seen'

// ---------------------------------------------------------------------------
// Placeholder chat messages so the chat tab feels alive
// ---------------------------------------------------------------------------

const WELCOME_MESSAGES = [
  {
    id: '1',
    role: 'assistant' as const,
    content:
      "Welcome to Apical! I'm your AI assistant. I can help you automate workflows, analyze data, manage agents, and much more. What would you like to do?",
    time: 'Just now',
  },
]

const SUGGESTED_PROMPTS = [
  { icon: Sparkles, text: 'Create a research agent' },
  { icon: ShieldCheck, text: 'Set up API key vault' },
  { icon: Zap, text: 'Automate a daily report' },
]

// ---------------------------------------------------------------------------
// FullscreenApp
// ---------------------------------------------------------------------------

export function FullscreenApp() {
  const [open, setOpen] = React.useState(false)
  const [closing, setClosing] = React.useState(false)
  const [activeTab, setActiveTab] = React.useState<AppTab>('chat')
  const [input, setInput] = React.useState('')
  const [messages, setMessages] = React.useState(WELCOME_MESSAGES)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // ---- Listen for the custom `apical:launch` event ----
  React.useEffect(() => {
    const handler = () => setOpen(true)
    window.addEventListener('apical:launch', handler)
    return () => window.removeEventListener('apical:launch', handler)
  }, [])

  // ---- Check sessionStorage on mount ----
  React.useEffect(() => {
    try {
      if (sessionStorage.getItem(SESSION_KEY) === '1') {
        setOpen(true)
      }
    } catch {
      // sessionStorage may be unavailable
    }
  }, [])

  // ---- Back to home (with exit animation) ----
  const goHome = React.useCallback(() => {
    setClosing(true)
    setTimeout(() => {
      setOpen(false)
      setClosing(false)
      try {
        sessionStorage.removeItem(SESSION_KEY)
      } catch {
        // ignore
      }
    }, 250)
  }, [])

  // ---- Send a chat message (demo) ----
  const sendMessage = React.useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed) return

    const userMsg = {
      id: Date.now().toString(),
      role: 'user' as const,
      content: trimmed,
      time: 'Just now',
    }

    const assistantMsg = {
      id: (Date.now() + 1).toString(),
      role: 'assistant' as const,
      content:
        "Thanks for your message! In the full Apical app, I'd process your request using the agent engine and connected tools. This is a demo preview — sign up to unlock the complete experience.",
      time: 'Just now',
    }

    setMessages((prev) => [...prev, userMsg, assistantMsg])
    setInput('')

    // Scroll to bottom after messages render
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
    })
  }, [input])

  // ---- Handle Enter key in textarea ----
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage],
  )

  if (!open) return null

  return (
    <div
      className={cn(
        'fixed inset-0 z-[9999] flex flex-col bg-background',
        closing ? 'animate-fullscreen-out' : 'animate-fullscreen-in',
      )}
    >
      {/* ---- Top bar ---- */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background/90 px-3 backdrop-blur-md md:px-4">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <ApicalMark className="h-7 w-7" />
          <span className="font-semibold tracking-tight text-[15px]">
            Apical<span className="text-primary">.</span>
          </span>
        </div>

        {/* Tab bar */}
        <div className="flex items-center gap-0.5 overflow-x-auto rounded-lg border border-border bg-muted/40 p-0.5">
          {TABS.map((t) => {
            const active = activeTab === t.key
            const Icon = t.icon
            return (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
                  active
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            )
          })}
        </div>

        {/* Right side: Back to home */}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={goHome}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <Home className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Back to home</span>
          </Button>
        </div>
      </header>

      {/* ---- Main content ---- */}
      <main className="min-h-0 flex-1 overflow-hidden">
        {activeTab === 'chat' && (
          <ChatTabContent
            messages={messages}
            input={input}
            setInput={setInput}
            sendMessage={sendMessage}
            handleKeyDown={handleKeyDown}
            scrollRef={scrollRef}
          />
        )}
        {activeTab === 'agents' && <AgentsTabContent />}
        {activeTab === 'vault' && <VaultTabContent />}
        {activeTab === 'data' && <DataTabContent />}
        {activeTab === 'billing' && <BillingTabContent />}
      </main>

      {/* ---- Footer ---- */}
      <footer className="shrink-0 border-t border-border bg-background/80 px-3 py-1 backdrop-blur-md md:px-4">
        <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Agent running
          </span>
          <span className="hidden sm:inline">Apical — Consider it Done.</span>
          <span>Demo preview</span>
        </div>
      </footer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat Tab
// ---------------------------------------------------------------------------

interface ChatTabContentProps {
  messages: typeof WELCOME_MESSAGES
  input: string
  setInput: (v: string) => void
  sendMessage: () => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  scrollRef: React.RefObject<HTMLDivElement | null>
}

function ChatTabContent({
  messages,
  input,
  setInput,
  sendMessage,
  handleKeyDown,
  scrollRef,
}: ChatTabContentProps) {
  const showSuggestions = messages.length <= 1

  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="mx-auto max-w-3xl px-4 py-5 md:px-6 space-y-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={cn(
                'flex gap-3',
                msg.role === 'user' ? 'justify-end' : 'justify-start',
              )}
            >
              {msg.role === 'assistant' && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <Bot className="h-4 w-4 text-primary" />
                </div>
              )}
              <div
                className={cn(
                  'max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground',
                )}
              >
                {msg.content}
              </div>
              {msg.role === 'user' && (
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-4 w-4 text-muted-foreground" />
                </div>
              )}
            </div>
          ))}

          {/* Suggested prompts */}
          {showSuggestions && (
            <div className="pt-4">
              <p className="mb-3 text-xs font-medium text-muted-foreground">
                Try asking…
              </p>
              <div className="flex flex-wrap gap-2">
                {SUGGESTED_PROMPTS.map((p) => (
                  <button
                    key={p.text}
                    className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground"
                  >
                    <p.icon className="h-3.5 w-3.5" />
                    {p.text}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input area */}
      <div className="shrink-0 border-t border-border bg-background px-3 py-3 md:px-4">
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Apical…"
            className="min-h-[44px] max-h-[160px] resize-none rounded-xl text-sm"
            rows={1}
          />
          <Button
            size="icon"
            onClick={sendMessage}
            disabled={!input.trim()}
            className="h-10 w-10 shrink-0 rounded-xl"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder Tabs
// ---------------------------------------------------------------------------

function AgentsTabContent() {
  return (
    <PlaceholderTab
      icon={Boxes}
      title="Agents"
      description="Deploy and manage autonomous AI agents that handle your workflows. Each agent is configured with specific tools, data access, and behavioral rules."
      items={[
        { name: 'Research Agent', status: 'Active', badge: 'Running' },
        { name: 'Data Monitor', status: 'Idle', badge: 'Paused' },
        { name: 'Email Assistant', status: 'Active', badge: 'Running' },
        { name: 'Report Generator', status: 'Draft', badge: 'Draft' },
      ]}
    />
  )
}

function VaultTabContent() {
  return (
    <PlaceholderTab
      icon={KeyRound}
      title="Vault"
      description="Securely store API keys, access tokens, and connection credentials. Your agents use these to interact with external services."
      items={[
        { name: 'OpenAI API Key', status: 'Connected', badge: 'Active' },
        { name: 'Gmail OAuth', status: 'Connected', badge: 'Active' },
        { name: 'Slack Token', status: 'Expired', badge: 'Needs update' },
        { name: 'Stripe Key', status: 'Not set', badge: 'Setup' },
      ]}
    />
  )
}

function DataTabContent() {
  return (
    <PlaceholderTab
      icon={Database}
      title="Data"
      description="Connect and manage data sources that your agents can query, analyze, and transform. Supports databases, spreadsheets, and APIs."
      items={[
        { name: 'Postgres — Production', status: 'Healthy', badge: 'Connected' },
        { name: 'Sales CSV Import', status: 'Pending', badge: 'Importing' },
        { name: 'Analytics API', status: 'Healthy', badge: 'Connected' },
      ]}
    />
  )
}

function BillingTabContent() {
  return (
    <PlaceholderTab
      icon={CreditCard}
      title="Billing"
      description="Manage your subscription, view usage metrics, and configure spending limits for your Apical workspace."
      items={[
        { name: 'Pro Plan', status: '$29/mo', badge: 'Active' },
        { name: 'Usage this month', status: '12,450 tokens', badge: '73%' },
        { name: 'Next billing date', status: 'Mar 15, 2026', badge: 'Upcoming' },
      ]}
    />
  )
}

// ---------------------------------------------------------------------------
// Reusable placeholder tab layout
// ---------------------------------------------------------------------------

interface PlaceholderItem {
  name: string
  status: string
  badge: string
}

function PlaceholderTab({
  icon: Icon,
  title,
  description,
  items,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
  items: PlaceholderItem[]
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 py-5 md:px-6">
        {/* Header */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-2">
            <Icon className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">{title}</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
        </div>

        {/* Items list */}
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.name}
              className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:bg-accent/30"
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.name}</p>
                <p className="text-xs text-muted-foreground">{item.status}</p>
              </div>
              <Badge variant="secondary" className="ml-3 shrink-0 text-[10px]">
                {item.badge}
              </Badge>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="mt-6 rounded-lg border border-dashed border-border bg-muted/30 p-6 text-center">
          <p className="text-sm text-muted-foreground mb-3">
            This is a demo preview. Sign up to unlock the full experience.
          </p>
          <Button variant="outline" size="sm" className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" />
            Back to home
          </Button>
        </div>
      </div>
    </div>
  )
}
