'use client'

import * as React from 'react'
import { useAppStore, newId } from '@/lib/store'
import { useAgentChat, useCreateWorkflow, useRunWorkflow } from '@/lib/queries'
import type { ChatMessage, WorkflowJSON } from '@/lib/types'
import { EXAMPLE_PROMPTS } from '@/lib/apical'
import { WorkflowFlow } from '../workflow-flow'
import { ApicalMark } from '../logo'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send,
  Sparkles,
  Check,
  Loader2,
  Play,
  Save,
  FolderSearch,
  FileText,
  ScanLine,
  Brain,
  ArrowRight,
  X,
} from 'lucide-react'

const EXAMPLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  files: FolderSearch,
  mail: FileText,
  audit: ScanLine,
  finance: Brain,
}

function AgentTrace({ trace }: { trace: { label: string; detail?: string }[] }) {
  if (!trace.length) return null
  return (
    <div className="mb-3 rounded-lg border border-border/60 bg-muted/30 p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        <FolderSearch className="h-3 w-3" />
        What I checked
      </div>
      <div className="space-y-1.5">
        {trace.map((t, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, x: -4 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.12 }}
            className="flex items-start gap-2 text-xs"
          >
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
            <div>
              <span className="text-foreground">{t.label}</span>
              {t.detail && <span className="text-muted-foreground"> — {t.detail}</span>}
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function WorkflowProposalCard({
  proposal,
  messageId,
}: {
  proposal: NonNullable<ChatMessage['workflowProposal']>
  messageId: string
}) {
  const { toast } = useToast()
  const createWf = useCreateWorkflow()
  const runWf = useRunWorkflow()
  const setView = useAppStore((s) => s.setView)
  const selectWorkflow = useAppStore((s) => s.selectWorkflow)
  const selectRun = useAppStore((s) => s.selectRun)
  const setPendingProposal = useAppStore((s) => s.setPendingProposal)
  const [done, setDone] = React.useState<'saved' | 'running' | null>(null)

  const steps = proposal.steps as WorkflowJSON

  const handleSave = async (run: boolean) => {
    try {
      const wf = await createWf.mutateAsync({
        name: proposal.name,
        description: proposal.description,
        steps,
        trigger: 'manual',
      })
      if (run) {
        const { runId } = await runWf.mutateAsync({ id: wf.id, trigger: 'manual' })
        setDone('running')
        toast({ title: 'Workflow saved & running', description: `"${wf.name}" is executing now.` })
        selectRun(runId)
        setView('runs')
      } else {
        setDone('saved')
        toast({ title: 'Workflow saved', description: `"${wf.name}" is ready in Workflows.` })
        selectWorkflow(wf.id)
        setView('workflows')
      }
      setPendingProposal(null)
    } catch (e) {
      toast({ title: 'Something went wrong', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const toolCount = steps.steps.filter((s) => s.kind === 'tool').length
  const reasonCount = steps.steps.filter((s) => s.kind === 'reason').length
  const gateCount = steps.steps.filter((s) => s.kind === 'gate').length

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-primary/30 bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-primary/5 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{proposal.name}</div>
            <div className="truncate text-[11px] text-muted-foreground">{proposal.description}</div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{toolCount} tool</span>
          <span className="rounded bg-reason/15 px-1.5 py-0.5 font-mono text-reason">{reasonCount} reason</span>
          {gateCount > 0 && (
            <span className="rounded bg-gate/15 px-1.5 py-0.5 font-mono text-gate-foreground">{gateCount} gate</span>
          )}
        </div>
      </div>

      <div className="max-h-[340px] overflow-y-auto p-3 bg-muted/10">
        <WorkflowFlow steps={steps.steps} compact />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2.5">
        {done === null ? (
          <>
            <Button size="sm" onClick={() => handleSave(true)} disabled={createWf.isPending || runWf.isPending}>
              {runWf.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
              Approve &amp; run
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleSave(false)} disabled={createWf.isPending}>
              <Save className="h-3.5 w-3.5" />
              Save only
            </Button>
            <span className="ml-auto text-[11px] text-muted-foreground">
              The AI only thinks at the <span className="text-reason">reason</span> steps.
            </span>
          </>
        ) : (
          <div className="flex w-full items-center gap-2 text-sm text-emerald-500">
            <Check className="h-4 w-4" />
            {done === 'running' ? 'Running — watch it in Runs.' : 'Saved — open it in Workflows.'}
            <ArrowRight className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user'
  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
          {message.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
          <ApicalMark className="h-4 w-4" />
        </div>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        {message.trace && message.trace.length > 0 && <AgentTrace trace={message.trace} />}
        <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{message.content}</div>
        {message.workflowProposal && (
          <WorkflowProposalCard proposal={message.workflowProposal} messageId={message.id} />
        )}
      </div>
    </div>
  )
}

function EmptyState({ onPick }: { onPick: (p: string) => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6 py-10 text-center">
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10"
      >
        <ApicalMark className="h-8 w-8" withGlow />
      </motion.div>
      <h2 className="text-xl font-semibold tracking-tight">Hire an AI for the repetitive work.</h2>
      <p className="mt-1.5 max-w-md text-sm text-muted-foreground text-balance">
        Describe a job in plain language. Apical looks around, proposes a workflow, and runs it on a schedule —
        only spending AI where judgment actually matters.
      </p>
      <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
        {EXAMPLE_PROMPTS.map((ex) => {
          const Icon = EXAMPLE_ICONS[ex.icon] ?? FolderSearch
          return (
            <button
              key={ex.title}
              onClick={() => onPick(ex.prompt)}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-3 text-left transition-all hover:border-primary/40 hover:bg-accent/40"
            >
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary">
                <Icon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium">{ex.title}</div>
                <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{ex.prompt}</div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function AgentView() {
  const messages = useAppStore((s) => s.messages)
  const addMessage = useAppStore((s) => s.addMessage)
  const chat = useAgentChat()
  const [input, setInput] = React.useState('')
  const scrollRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages, chat.isPending])

  const send = async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || chat.isPending) return
    const userMsg: ChatMessage = {
      id: newId(),
      role: 'user',
      content: trimmed,
      createdAt: new Date().toISOString(),
    }
    addMessage(userMsg)
    setInput('')

    try {
      const res = await chat.mutateAsync({
        message: trimmed,
        history: messages,
      })
      const agentMsg: ChatMessage = {
        id: newId(),
        role: 'agent',
        content: res.reply,
        trace: res.trace,
        workflowProposal: res.workflowProposal,
        createdAt: new Date().toISOString(),
      }
      addMessage(agentMsg)
    } catch (e) {
      addMessage({
        id: newId(),
        role: 'agent',
        content: `I hit a snag: ${(e as Error).message}. Try rephrasing the job?`,
        createdAt: new Date().toISOString(),
      })
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      send(input)
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem-2.625rem)] flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-4 py-6 md:px-6">
          {messages.length === 0 ? (
            <EmptyState onPick={(p) => send(p)} />
          ) : (
            <div className="space-y-5">
              <AnimatePresence initial={false}>
                {messages.map((m) => (
                  <motion.div
                    key={m.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <MessageBubble message={m} />
                  </motion.div>
                ))}
              </AnimatePresence>
              {chat.isPending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                      <ApicalMark className="h-4 w-4" />
                    </div>
                  </div>
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-border bg-card px-3.5 py-2.5">
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    <span className="text-sm text-muted-foreground">Thinking it over…</span>
                    <span className="flex gap-1">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                    </span>
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-3xl px-4 py-3 md:px-6">
          <div className="relative rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-colors">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={'Describe a job…  e.g. "Sort the PDFs my scanner dumps into /Scan Inbox"'}
              rows={1}
              className="min-h-[52px] max-h-40 resize-none border-0 bg-transparent px-4 py-3 pr-14 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <Button
              size="icon"
              onClick={() => send(input)}
              disabled={!input.trim() || chat.isPending}
              className="absolute bottom-2.5 right-2.5 h-8 w-8 rounded-lg"
              aria-label="Send"
            >
              {chat.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="mt-1.5 flex items-center justify-between px-1 text-[10px] text-muted-foreground">
            <span>Apical proposes a plan. You approve. It runs.</span>
            <span className="hidden sm:inline">
              <kbd className="rounded border border-border px-1 font-mono">Enter</kbd> to send ·{' '}
              <kbd className="rounded border border-border px-1 font-mono">Shift+Enter</kbd> for newline
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
