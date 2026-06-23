'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Separator } from '@/components/ui/separator'
import {
  MessageSquare,
  Boxes,
  KeyRound,
  Database,
  CreditCard,
  Send,
  Loader2,
  CheckCircle2,
  Wrench,
  ChevronRight,
  Plus,
  Sparkles,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// ApicalMark — stylised "A" / mountain-peak logo in the primary green colour
// ---------------------------------------------------------------------------

export function ApicalMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn('h-7 w-7', className)}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="demoApicalGrad" x1="0" y1="32" x2="32" y2="0" gradientUnits="userSpaceOnUse">
          <stop stopColor="oklch(0.62 0.15 158)" />
          <stop offset="1" stopColor="oklch(0.78 0.16 170)" />
        </linearGradient>
      </defs>
      <path
        d="M16 2 L29 28 L22.5 28 L16 14 L9.5 28 L3 28 Z"
        fill="url(#demoApicalGrad)"
      />
      <circle cx="16" cy="6.5" r="2.1" fill="oklch(0.95 0.05 160)" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type TabKey = 'chat' | 'agents' | 'vault' | 'data' | 'billing'

interface DemoMessage {
  id: string
  role: 'user' | 'agent'
  content: string
  /** Simulated agent events shown above the text */
  events?: DemoEvent[]
}

interface DemoEvent {
  type: 'tool_call' | 'status'
  tool?: string
  status?: 'calling' | 'done'
  label?: string
}

// ---------------------------------------------------------------------------
// Sidebar tab definitions
// ---------------------------------------------------------------------------

const TABS: { key: TabKey; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'chat', label: 'Chat', icon: MessageSquare },
  { key: 'agents', label: 'Agents', icon: Boxes },
  { key: 'vault', label: 'Vault', icon: KeyRound },
  { key: 'data', label: 'Data', icon: Database },
  { key: 'billing', label: 'Billing', icon: CreditCard },
]

// ---------------------------------------------------------------------------
// Pre-filled demo messages
// ---------------------------------------------------------------------------

const INITIAL_MESSAGES: DemoMessage[] = [
  {
    id: 'm1',
    role: 'user',
    content: 'Check all invoices from last week and flag any over $5,000',
  },
  {
    id: 'm2',
    role: 'agent',
    content:
      "I've scanned 47 invoices from last week. Found 3 over $5,000. They're flagged and ready for your review.",
    events: [
      { type: 'tool_call', tool: 'files.search', status: 'done', label: 'Searching invoices…' },
      { type: 'tool_call', tool: 'ocr.scan', status: 'done', label: 'Reading 47 documents' },
      { type: 'status', label: 'Done' },
    ],
  },
  {
    id: 'm3',
    role: 'user',
    content: 'Good. Sort the remaining ones into client folders.',
  },
  {
    id: 'm4',
    role: 'agent',
    content:
      'Done. 44 invoices sorted into 12 client folders. The Filing agent will handle new ones automatically.',
    events: [
      { type: 'tool_call', tool: 'files.move', status: 'done', label: 'Moving 44 invoices' },
      { type: 'tool_call', tool: 'cli.exec', status: 'done', label: 'Updating folder rules' },
      { type: 'status', label: 'Done' },
    ],
  },
]

// ---------------------------------------------------------------------------
// Auto-response messages for the demo
// ---------------------------------------------------------------------------

const AUTO_RESPONSES = [
  "I've started working on that. I'll use the Filing agent to handle this automatically.",
  "Done! I've processed your request and updated the relevant records. Let me know if you need anything else.",
  "That's been taken care of. The agent will keep monitoring for new items matching this pattern.",
  "I've set up an automated workflow for this. It will run on schedule without you needing to check.",
  "All set. I've sorted, tagged, and filed everything. The results are in your dashboard.",
  "Working on it now... I've identified the relevant items and applied the appropriate actions.",
]

// ---------------------------------------------------------------------------
// Event renderer
// ---------------------------------------------------------------------------

function DemoToolCallEvent({ ev }: { ev: DemoEvent }) {
  const isDone = ev.status === 'done'
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-[11px]',
        isDone
          ? 'border-emerald-500/20 bg-emerald-500/5'
          : 'border-primary/30 bg-primary/5',
      )}
    >
      <Wrench className={cn('h-3 w-3 shrink-0', isDone ? 'text-emerald-500' : 'text-primary')} />
      {isDone ? (
        <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
      ) : (
        <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
      )}
      <code className="font-mono text-[10px] text-muted-foreground">{ev.tool}</code>
      <span className="text-muted-foreground">{ev.label}</span>
    </div>
  )
}

function DemoStatusEvent({ ev }: { ev: DemoEvent }) {
  const isDone = ev.label === 'Done'
  return (
    <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
      {isDone ? (
        <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500" />
      ) : (
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      )}
      <span className={isDone ? 'text-emerald-500' : ''}>{ev.label}</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Message bubbles
// ---------------------------------------------------------------------------

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
        {content}
      </div>
    </div>
  )
}

function AgentBubble({ content, events }: { content: string; events?: DemoEvent[] }) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary">
          AP
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        {events && events.length > 0 && (
          <div className="space-y-1">
            {events.map((ev, i) => {
              if (ev.type === 'tool_call') return <DemoToolCallEvent key={i} ev={ev} />
              if (ev.type === 'status') return <DemoStatusEvent key={i} ev={ev} />
              return null
            })}
          </div>
        )}
        <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">
          {content}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Placeholder tab content (non-chat tabs)
// ---------------------------------------------------------------------------

function PlaceholderTab({ label, icon: Icon }: { label: string; icon: React.ComponentType<{ className?: string }> }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-muted-foreground">
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-muted/40">
        <Icon className="h-5 w-5" />
      </div>
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground/60">Available in the full app</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DemoApp — the main component
// ---------------------------------------------------------------------------

export function DemoApp() {
  const [activeTab, setActiveTab] = React.useState<TabKey>('chat')
  const [input, setInput] = React.useState('')
  const [messages, setMessages] = React.useState<DemoMessage[]>(INITIAL_MESSAGES)
  const [isTyping, setIsTyping] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const responseIndexRef = React.useRef(0)

  // Auto-scroll when messages change
  React.useEffect(() => {
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
      })
    }
  }, [messages, isTyping])

  const sendMessage = React.useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || isTyping) return

    const userMsg: DemoMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content: trimmed,
    }

    setMessages((prev) => [...prev, userMsg])
    setInput('')
    setIsTyping(true)

    // Simulate agent "thinking" then responding
    const delay = 800 + Math.random() * 1200
    setTimeout(() => {
      const responseText = AUTO_RESPONSES[responseIndexRef.current % AUTO_RESPONSES.length]
      responseIndexRef.current += 1

      const agentMsg: DemoMessage = {
        id: `agent-${Date.now()}`,
        role: 'agent',
        content: responseText,
        events: [
          { type: 'tool_call', tool: 'agent.run', status: 'done', label: 'Processing request…' },
          { type: 'status', label: 'Done' },
        ],
      }

      setMessages((prev) => [...prev, agentMsg])
      setIsTyping(false)
    }, delay)
  }, [input, isTyping])

  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
      }
    },
    [sendMessage],
  )

  return (
    <div className="flex h-full w-full overflow-hidden rounded-lg border border-border bg-background text-foreground shadow-sm">
      {/* ---- Sidebar ---- */}
      <TooltipProvider delayDuration={150}>
        <aside className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border bg-muted/30 py-3 md:w-14">
          {/* Logo */}
          <div className="mb-2 flex h-8 w-8 items-center justify-center">
            <ApicalMark className="h-6 w-6" />
          </div>

          <Separator className="mx-2 mb-1 w-6" />

          {/* Tab icons */}
          {TABS.map((t) => {
            const Icon = t.icon
            const active = activeTab === t.key
            return (
              <Tooltip key={t.key}>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => setActiveTab(t.key)}
                    className={cn(
                      'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
                      active
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                    aria-label={t.label}
                    aria-current={active ? 'page' : undefined}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">
                  {t.label}
                </TooltipContent>
              </Tooltip>
            )
          })}

          {/* Spacer pushes the "new chat" button to the bottom */}
          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent/50 hover:text-foreground transition-colors"
                aria-label="New chat"
                onClick={() => {
                  setMessages(INITIAL_MESSAGES)
                  setActiveTab('chat')
                  setInput('')
                }}
              >
                <Plus className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs">
              New chat
            </TooltipContent>
          </Tooltip>
        </aside>
      </TooltipProvider>

      {/* ---- Main area ---- */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Header bar */}
        <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
          <span className="text-xs font-medium">
            {TABS.find((t) => t.key === activeTab)?.label}
          </span>

          {activeTab === 'chat' && (
            <>
              <span className="text-[10px] text-muted-foreground">
                Invoice workflow
              </span>
              <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
                {isTyping ? (
                  <>
                    <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />
                    Thinking…
                  </>
                ) : (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Agent running
                  </>
                )}
              </span>
            </>
          )}
        </header>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat' && (
            <ChatView
              messages={messages}
              input={input}
              setInput={setInput}
              sendMessage={sendMessage}
              handleKeyDown={handleKeyDown}
              isTyping={isTyping}
              scrollRef={scrollRef}
            />
          )}
          {activeTab === 'agents' && <PlaceholderTab label="Agents" icon={Boxes} />}
          {activeTab === 'vault' && <PlaceholderTab label="Vault" icon={KeyRound} />}
          {activeTab === 'data' && <PlaceholderTab label="Data" icon={Database} />}
          {activeTab === 'billing' && <PlaceholderTab label="Billing" icon={CreditCard} />}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Chat view (the primary demo view)
// ---------------------------------------------------------------------------

function ChatView({
  messages,
  input,
  setInput,
  sendMessage,
  handleKeyDown,
  isTyping,
  scrollRef,
}: {
  messages: DemoMessage[]
  input: string
  setInput: React.Dispatch<React.SetStateAction<string>>
  sendMessage: () => void
  handleKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  isTyping: boolean
  scrollRef: React.RefObject<HTMLDivElement | null>
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Messages */}
      <ScrollArea className="flex-1" ref={scrollRef}>
        <div className="mx-auto max-w-2xl px-4 py-4">
          {/* Greeting */}
          <div className="mb-5 flex flex-col items-center py-6 text-center">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm font-medium">Apical Assistant</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Your AI agent is ready to handle invoices, filings, and more.
            </p>
          </div>

          {/* Pre-filled + user messages */}
          <div className="space-y-4">
            {messages.map((m) =>
              m.role === 'user' ? (
                <UserBubble key={m.id} content={m.content} />
              ) : (
                <AgentBubble key={m.id} content={m.content} events={m.events} />
              ),
            )}

            {/* Typing indicator */}
            {isTyping && (
              <div className="flex gap-2.5">
                <div className="mt-0.5 shrink-0">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10 text-[10px] font-semibold text-primary">
                    AP
                  </div>
                </div>
                <div className="flex items-center gap-1 rounded-2xl bg-muted px-4 py-2.5">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '0ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '150ms' }} />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground/60" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}
          </div>
        </div>
      </ScrollArea>

      {/* Composer */}
      <div className="shrink-0 border-t border-border bg-background/80 p-3 backdrop-blur-md">
        <div className="mx-auto max-w-2xl">
          <div className="relative rounded-xl border border-border bg-card transition-colors focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Message assistant…"
              rows={1}
              className="min-h-[44px] max-h-32 w-full resize-none border-0 bg-transparent px-3 py-2.5 pr-12 text-sm shadow-none focus:outline-none placeholder:text-muted-foreground"
            />
            <button
              className="absolute bottom-2 right-2 flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              disabled={!input.trim() || isTyping}
              onClick={sendMessage}
              aria-label="Send"
            >
              <Send className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1 px-1 text-[10px] text-muted-foreground">
            <kbd className="rounded border border-border px-1 font-mono">Enter</kbd>{' '}
            send ·{' '}
            <kbd className="rounded border border-border px-1 font-mono">Shift+Enter</kbd>{' '}
            new line
          </div>
        </div>
      </div>
    </div>
  )
}
