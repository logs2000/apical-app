'use client'

import * as React from 'react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useAppStore, newId } from '@/lib/store'
import {
  useAgentChat,
  useConversations,
  useCreateConversation,
  useUpdateConversation,
  useDeleteConversation,
  useWorkflows,
  useWorkflow,
  useCreateWorkflow,
  useRunWorkflow,
  useImportEmployee,
  useProfile,
  useBriefing,
} from '@/lib/queries'
import type { ChatMessage, WorkflowJSON, Workflow } from '@/lib/types'
import { WorkflowFlow } from './workflow-flow'
import { ApicalMark } from './logo'
import { departmentMeta, agentInitials, agentAvatarLightness, DEFAULT_PROMPTS, relativeTime } from '@/lib/apical'
import { ClarificationCard, ApiDiscoveryCard, SuggestionsList, ResearchCard, ScriptAnalysisCard } from './chat-cards'
import { ResearchPlanCard } from './research-plan-card'
import { MentionComposer, MentionChip, type Mention } from './mention'
import { BriefingMessage } from './briefing-message'
import { AgentLoopTrace, useAgentLoop, type AgentLoopEvent } from './agent-loop-trace'
import { useToast } from '@/hooks/use-toast'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useConnectMcp } from '@/lib/queries'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Send, Plus, Loader2, Play, Save, FolderSearch, Check, Upload, FileJson,
  PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen,
  MoreHorizontal, Pin, Trash2, Download, MessageSquare, Sparkles,
  ArrowRight, X, Boxes, ChevronDown, Plug, Brain,
} from 'lucide-react'

// ============== History sidebar (left) ==============
function HistorySidebar() {
  const { data: conversations } = useConversations(useAppStore((s) => s.activeWorkspaceId))
  const activeId = useAppStore((s) => s.activeConversationId)
  const setActive = useAppStore((s) => s.setActiveConversation)
  const setMessages = useAppStore((s) => s.setMessages)
  const createConv = useCreateConversation()
  const updateConv = useUpdateConversation()
  const deleteConv = useDeleteConversation()

  const pinned = conversations?.filter((c) => c.pinned) ?? []
  const rest = conversations?.filter((c) => !c.pinned) ?? []

  const newChat = async () => {
    const c = await createConv.mutateAsync({ workspaceId: useAppStore.getState().activeWorkspaceId })
    setActive(c.id)
    setMessages([])
  }

  return (
    <div className="flex h-full flex-col bg-sidebar/50">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <Button size="sm" className="h-7 flex-1 justify-start gap-1.5 text-xs" onClick={newChat} disabled={createConv.isPending}>
          <Plus className="h-3.5 w-3.5" /> New chat
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {pinned.length > 0 && (
          <>
            <div className="px-1 pb-1 pt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Pinned</div>
            {pinned.map((c) => (
              <ConvRow key={c.id} conv={c} active={c.id === activeId} onClick={() => setActive(c.id)}
                onPin={() => updateConv.mutate({ id: c.id, patch: { pinned: !c.pinned } })}
                onDelete={() => { deleteConv.mutate(c.id); if (c.id === activeId) { setActive(null); setMessages([]) } }} />
            ))}
          </>
        )}
        <div className="px-1 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">Recent</div>
        {rest.length === 0 ? (
          <div className="px-2 py-4 text-center text-[11px] text-muted-foreground">No conversations yet.</div>
        ) : (
          rest.map((c) => (
            <ConvRow key={c.id} conv={c} active={c.id === activeId} onClick={() => setActive(c.id)}
              onPin={() => updateConv.mutate({ id: c.id, patch: { pinned: !c.pinned } })}
              onDelete={() => { deleteConv.mutate(c.id); if (c.id === activeId) { setActive(null); setMessages([]) } }} />
          ))
        )}
      </div>
    </div>
  )
}

function ConvRow({ conv, active, onClick, onPin, onDelete }: {
  conv: { id: string; title: string; pinned: boolean; updatedAt: string }
  active: boolean; onClick: () => void; onPin: () => void; onDelete: () => void
}) {
  return (
    <div className={cn('group relative flex items-center rounded-lg px-2.5 py-1.5 text-xs transition-colors',
      active ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground')}>
      <button onClick={onClick} className="min-w-0 flex-1 text-left">
        <div className="truncate font-medium">{conv.title}</div>
        <div className="text-[10px] text-muted-foreground/70">{relativeTime(conv.updatedAt)}</div>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="ml-1 hidden h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-background group-hover:flex" aria-label="Options">
            <MoreHorizontal className="h-3 w-3" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem onClick={onPin}><Pin className="mr-2 h-3 w-3" /> {conv.pinned ? 'Unpin' : 'Pin'}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-3 w-3" /> Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ============== Workflow pane (right) ==============
function WorkflowPane() {
  const focusWorkflowId = useAppStore((s) => s.focusWorkflowId)
  const messages = useAppStore((s) => s.messages)
  const setRightPaneOpen = useAppStore((s) => s.setRightPaneOpen)
  const setMode = useAppStore((s) => s.setMode)
  const selectWorkflow = useAppStore((s) => s.selectWorkflow)

  const latestProposal = React.useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].workflowProposal) return messages[i].workflowProposal
    }
    return null
  }, [messages])

  const wfId = focusWorkflowId
  const { data: wfData } = useWorkflow(wfId)
  const showWf = wfData?.workflow
  const steps = showWf?.steps.steps ?? latestProposal?.steps.steps ?? []
  const name = showWf?.name ?? latestProposal?.name ?? 'No workflow'
  const title = showWf?.title ?? latestProposal?.title
  const dept = showWf?.department ?? latestProposal?.department
  const deptMeta = dept ? departmentMeta(dept) : null

  return (
    <div className="flex h-full flex-col bg-card/30">
      <div className="flex h-10 items-center gap-2 border-b border-border px-3">
        <Boxes className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="text-xs font-medium">Workflow</span>
        <Button variant="ghost" size="icon" className="ml-auto h-6 w-6" onClick={() => setRightPaneOpen(false)} aria-label="Hide pane">
          <PanelRightClose className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {steps.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 text-center text-muted-foreground">
            <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-lg border border-dashed border-border"><Boxes className="h-5 w-5" /></div>
            <p className="text-xs">@mention an agent or propose one and its workflow shows here.</p>
          </div>
        ) : (
          <>
            <div className="mb-3 rounded-lg border border-border bg-card p-2.5">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-primary-foreground"
                  style={{ backgroundColor: `oklch(${agentAvatarLightness(name)} 0.08 155)` }}>
                  {agentInitials(name)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {title ? `${title}` : ''}{deptMeta ? ` · ${deptMeta.name}` : ''}
                  </div>
                </div>
              </div>
              {latestProposal && !showWf && <p className="mt-2 text-[11px] text-muted-foreground">{latestProposal.description}</p>}
            </div>
            <WorkflowFlow steps={steps} compact />
            {showWf && (
              <Button variant="outline" size="sm" className="mt-3 w-full text-xs"
                onClick={() => { selectWorkflow(showWf.id); setMode('developer') }}>
                Open in developer view
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ============== Proposal card ==============
function ProposalCard({ proposal }: { proposal: NonNullable<ChatMessage['workflowProposal']> }) {
  const { toast } = useToast()
  const createWf = useCreateWorkflow()
  const runWf = useRunWorkflow()
  const setFocusWorkflow = useAppStore((s) => s.setFocusWorkflow)
  const selectRun = useAppStore((s) => s.selectRun)
  const [done, setDone] = React.useState<'created' | 'running' | null>(null)
  const deptMeta = departmentMeta(proposal.department)
  const steps = proposal.steps as WorkflowJSON

  const handleCreate = async (run: boolean) => {
    try {
      const wf = await createWf.mutateAsync({
        name: proposal.name, description: proposal.description, steps, trigger: 'manual',
        department: proposal.department, title: proposal.title,
        workspaceId: useAppStore.getState().activeWorkspaceId,
      })
      if (run) {
        const { runId } = await runWf.mutateAsync({ id: wf.id, trigger: 'manual' })
        setDone('running')
        toast({ title: `${wf.name} created & running`, description: 'See it in the Agents tab.' })
        selectRun(runId)
        setFocusWorkflow(wf.id)
      } else {
        setDone('created')
        toast({ title: `${wf.name} created`, description: `${proposal.title ?? 'Agent'} added to ${deptMeta.name}.` })
        setFocusWorkflow(wf.id)
      }
    } catch (e) {
      toast({ title: 'Something went wrong', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const exportJson = () => {
    const data = { name: proposal.name, description: proposal.description, department: proposal.department, title: proposal.title, trigger: { type: 'manual' as const }, steps: steps.steps }
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${proposal.name.toLowerCase().replace(/\s+/g, '-')}.json`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mt-2.5 overflow-hidden rounded-xl border border-primary/30 bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border/60 bg-primary/5 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
            style={{ backgroundColor: `oklch(${agentAvatarLightness(proposal.name)} 0.08 155)` }}>
            {agentInitials(proposal.name)}
          </div>
          <div className="min-w-0">
            <div className="truncate text-xs font-medium">{proposal.name} <span className="text-muted-foreground">· {proposal.title ?? 'Agent'}</span></div>
            <div className="truncate text-[10px] text-muted-foreground">{deptMeta.name}</div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-1 text-[10px] text-muted-foreground">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono">{steps.steps.filter((s) => s.kind === 'tool').length} tool</span>
          <span className="rounded bg-reason/15 px-1.5 py-0.5 font-mono text-reason">{steps.steps.filter((s) => s.kind === 'reason').length} reason</span>
          <span className="rounded bg-gate/15 px-1.5 py-0.5 font-mono text-gate-foreground">{steps.steps.filter((s) => s.kind === 'gate').length} gate</span>
        </div>
      </div>
      <p className="px-3 py-2 text-xs text-muted-foreground">{proposal.description}</p>
      <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-3 py-2">
        {done === null ? (
          <>
            <Button size="sm" onClick={() => handleCreate(true)} disabled={createWf.isPending || runWf.isPending} className="text-xs">
              {runWf.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Play className="mr-1 h-3 w-3" />} Create &amp; run
            </Button>
            <Button size="sm" variant="outline" onClick={() => handleCreate(false)} disabled={createWf.isPending} className="text-xs">
              <Save className="mr-1 h-3 w-3" /> Just create
            </Button>
            <Button size="sm" variant="ghost" onClick={exportJson} className="ml-auto text-xs text-muted-foreground">
              <Download className="mr-1 h-3 w-3" /> Export
            </Button>
          </>
        ) : (
          <div className="flex w-full items-center gap-2 text-xs text-emerald-500">
            <Check className="h-3.5 w-3.5" /> {done === 'running' ? 'Running — see it in Agents.' : 'Created.'}
          </div>
        )}
      </div>
    </div>
  )
}

function SwitchPrompt({ agentName, onAccept }: { agentName: string; onAccept: () => void }) {
  return (
    <div className="mt-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs">
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="flex-1">Sounds like <strong>{agentName}</strong>'s job. Pull up their file?</span>
      <Button size="sm" variant="outline" onClick={onAccept} className="h-6 px-2 text-[11px]">Switch</Button>
    </div>
  )
}

// ============== Message bubble ==============
function MessageBubble({ message, onClarify, onAsk, onViewRun }: {
  message: ChatMessage
  onClarify: (optionKey: string, customText?: string) => void
  onAsk: (prompt: string, mentions?: Mention[]) => void
  onViewRun: (runId: string) => void
}) {
  const isUser = message.role === 'user'
  const { data: agents } = useWorkflows()

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-sm text-primary-foreground">
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
        {message.trace && message.trace.length > 0 && (
          <div className="rounded-lg border border-border/60 bg-muted/30 p-2.5">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              <FolderSearch className="h-3 w-3" /> What I checked
            </div>
            <div className="space-y-1">
              {message.trace.map((t, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[11px]">
                  <Check className="mt-0.5 h-2.5 w-2.5 shrink-0 text-emerald-500" />
                  <span className="text-foreground">{t.label}</span>
                  {t.detail && <span className="text-muted-foreground"> — {t.detail}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
        {message.briefing ? (
          <BriefingMessage briefing={message.briefing} onAction={(a, item) => onAsk(`About the flagged item "${item.title}": ${item.detail}`, [{ id: item.agentId, name: item.agentName, department: '' }])} onViewRun={onViewRun} onAsk={onAsk} />
        ) : (
          <>
            {message.content && <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap">{message.content}</div>}
            {message.agentLoopEvents && message.agentLoopEvents.length > 0 && (
              <AgentLoopTrace events={message.agentLoopEvents} isStreaming={false} />
            )}
            {message.suggestions && message.suggestions.length > 0 && (
              <SuggestionsList suggestions={message.suggestions} onPick={(p) => onClarify('suggestion:' + p)} />
            )}
            {message.workflowProposal && <ProposalCard proposal={message.workflowProposal} />}
            {message.clarification && (
              <ClarificationCard question={message.clarification} onAnswer={onClarify} onSkip={() => onClarify('skip')} />
            )}
            {message.apiDiscovery && message.apiDiscovery.length > 0 && (
              <ApiDiscoveryCard candidates={message.apiDiscovery} />
            )}
            {message.research && (
              <ResearchCard research={message.research} />
            )}
            {message.scriptAnalysis && (
              <ScriptAnalysisCard analysis={message.scriptAnalysis} />
            )}
            {message.researchPlan && (
              <ResearchPlanCard
                plan={message.researchPlan}
                onApprove={() => {
                  if (message.researchPlan) {
                    send(`Create an agent for this research plan: ${message.researchPlan.strategy}`)
                  }
                }}
                onTweak={() => onAsk('What would you like to change about the plan?')}
              />
            )}
            {message.switchToAgentId && (
              <SwitchPrompt agentName={agents?.find((a) => a.id === message.switchToAgentId)?.name ?? 'that agent'} onAccept={() => onAsk('Tell me about this agent', [{ id: message.switchToAgentId!, name: agents?.find((a) => a.id === message.switchToAgentId)?.name ?? 'agent', department: '' }])} />
            )}
          </>
        )}
      </div>
    </div>
  )
}

// (ChatMessage.briefing is typed in src/lib/types.ts as BriefingPayload.)

// ============== Chat center ==============
function ChatCenter() {
  const messages = useAppStore((s) => s.messages)
  const addMessage = useAppStore((s) => s.addMessage)
  const setMessages = useAppStore((s) => s.setMessages)
  const activeConversationId = useAppStore((s) => s.activeConversationId)
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)
  const setFocusWorkflow = useAppStore((s) => s.setFocusWorkflow)
  const selectRun = useAppStore((s) => s.selectRun)
  const setMode = useAppStore((s) => s.setMode)
  const chat = useAgentChat()
  const importEmp = useImportEmployee()
  const createConv = useCreateConversation()
  const updateConv = useUpdateConversation()
  const { data: briefing } = useBriefing(activeWorkspaceId)

  const [input, setInput] = React.useState('')
  const [mentions, setMentions] = React.useState<Mention[]>([])
  const [dragging, setDragging] = React.useState(false)
  const [loopStreaming, setLoopStreaming] = React.useState(false)
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const textareaRef = React.useRef<HTMLTextAreaElement>(null)
  const { toast } = useToast()

  React.useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, chat.isPending])

  // When the chat is empty AND we have a briefing, render it inline as the
  // opening message (not via useEffect, to avoid hydration mismatches).
  const showBriefing = messages.length === 0 && briefing

  const send = async (text: string, msgMentions?: Mention[]) => {
    const trimmed = text.trim() || (attachedScript ? 'Analyze this script and tell me what API it calls.' : '')
    if (!trimmed || chat.isPending || loopStreaming) return

    const mentionLabel = (msgMentions ?? mentions).length > 0
      ? (msgMentions ?? mentions).map((m) => `@${m.name}`).join(' ') + ' '
      : ''
    const scriptLabel = attachedScript ? ` (attached: ${attachedScript.name})` : ''
    addMessage({ id: newId(), role: 'user', content: mentionLabel + trimmed + scriptLabel, createdAt: new Date().toISOString() })
    setInput('')
    setMentions([])
    const sentScript = attachedScript
    setAttachedScript(null)

    // Ensure we have a conversation to attach the messages to.
    let convId = activeConversationId
    if (!convId) {
      const c = await createConv.mutateAsync({ workspaceId: activeWorkspaceId })
      convId = c.id
      useAppStore.getState().setActiveConversation(c.id)
    }

    // Always route through the autonomous agent loop. The LLM decides
    // naturally whether to use tools (research, web, MCP, code) or answer
    // directly — for "What is 2+2?" it emits a final answer in one step;
    // for "Find Linear's pricing" it searches the web + proposes a workflow.
    const loopId = newId()
    addMessage({ id: loopId, role: 'agent', content: '', agentLoopEvents: [], createdAt: new Date().toISOString() })
    setLoopStreaming(true)

    // Build context from the conversation history (last few messages) + any
    // attached script, so the agent has continuity.
    const recentHistory = messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n')
    const contextParts: string[] = []
    if (recentHistory) contextParts.push(`Recent conversation:\n${recentHistory}`)
    if (sentScript) contextParts.push(`Attached script (${sentScript.name}, ${sentScript.language}):\n${sentScript.content.slice(0, 4000)}`)
    if ((msgMentions ?? mentions).length > 0) {
      contextParts.push(`Mentioned agents: ${(msgMentions ?? mentions).map((m) => m.name).join(', ')}`)
    }

    try {
      const res = await fetch('/api/agent/think', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: trimmed,
          context: contextParts.join('\n\n') || undefined,
          maxIterations: 16,
        }),
      })
      if (!res.ok || !res.body) {
        setMessages(useAppStore.getState().messages.map((m) => m.id === loopId ? { ...m, agentLoopEvents: [{ type: 'error', message: `Request failed (${res.status})` }] } : m))
        setLoopStreaming(false)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let finalEvent: AgentLoopEvent | null = null
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const parts = buffer.split('\n\n')
        buffer = parts.pop() ?? ''
        for (const part of parts) {
          const line = part.trim()
          if (!line.startsWith('data: ')) continue
          try {
            const evt = JSON.parse(line.slice(6)) as AgentLoopEvent
            if (evt.type === 'final') finalEvent = evt
            // Append the event to the loop message.
            const current = useAppStore.getState().messages.find((m) => m.id === loopId)
            if (current) {
              setMessages(useAppStore.getState().messages.map((m) => m.id === loopId ? { ...m, agentLoopEvents: [...(current.agentLoopEvents ?? []), evt] } : m))
            }
          } catch { /* ignore malformed */ }
        }
      }

      // After the stream completes, if the agent proposed a workflow, attach
      // it as a workflowProposal so the ProposalCard renders with Create/Run.
      if (finalEvent && finalEvent.type === 'final' && finalEvent.proposedWorkflow && finalEvent.proposedWorkflow.steps.length > 0) {
        const wf = finalEvent.proposedWorkflow
        // Derive a name + description from the workflow_propose tool output
        // (stored in the observation event) if the final didn't carry them.
        const proposeObs = (useAppStore.getState().messages.find((m) => m.id === loopId)?.agentLoopEvents ?? [])
          .filter((e) => e.type === 'observation' && e.tool === 'workflow_propose' && e.ok)
          .pop()
        const proposeOutput = (proposeObs?.output as { name?: string; description?: string; schedule?: string } | null) ?? {}
        const current = useAppStore.getState().messages.find((m) => m.id === loopId)
        if (current) {
          setMessages(useAppStore.getState().messages.map((m) => m.id === loopId ? {
            ...m,
            content: finalEvent.answer || m.content,
            workflowProposal: {
              name: proposeOutput.name || 'New Agent',
              description: proposeOutput.description || 'Agent proposed by deep research.',
              department: 'General',
              steps: wf,
            },
          } : m))
        }
      } else if (finalEvent && finalEvent.type === 'final') {
        // No workflow — just set the answer as the content.
        const current = useAppStore.getState().messages.find((m) => m.id === loopId)
        if (current) {
          setMessages(useAppStore.getState().messages.map((m) => m.id === loopId ? { ...m, content: finalEvent.answer } : m))
        }
      }

      // Auto-title the conversation on the first exchange.
      if (messages.length === 0 && convId && finalEvent) {
        const title = trimmed.slice(0, 50)
        updateConv.mutate({ id: convId, patch: { title } })
      }
    } catch (e) {
      const current = useAppStore.getState().messages.find((m) => m.id === loopId)
      if (current) {
        setMessages(useAppStore.getState().messages.map((m) => m.id === loopId ? { ...m, agentLoopEvents: [...(current.agentLoopEvents ?? []), { type: 'error', message: (e as Error).message }] } : m))
      }
    } finally {
      setLoopStreaming(false)
    }
  }

  const [attachedScript, setAttachedScript] = React.useState<{ name: string; content: string; language: string } | null>(null)
  const [model, setModel] = React.useState<string>('default')

  const detectLanguage = (name: string): string => {
    if (name.endsWith('.py')) return 'python'
    if (name.endsWith('.js') || name.endsWith('.mjs')) return 'javascript'
    if (name.endsWith('.ts')) return 'typescript'
    if (name.endsWith('.sh') || name.endsWith('.bash')) return 'bash'
    if (name.endsWith('.curl') || name.endsWith('.http')) return 'curl'
    if (name.endsWith('.rb')) return 'ruby'
    if (name.endsWith('.go')) return 'go'
    return 'auto'
  }

  const onFile = async (file: File) => {
    const text = await file.text()
    if (file.name.endsWith('.json')) {
      // JSON → import as an agent
      try {
        const res = await importEmp.mutateAsync({ json: text })
        addMessage({ id: newId(), role: 'agent', content: `Imported ${res.employee.name}${res.employee.title ? ` (${res.employee.title})` : ''} into ${departmentMeta(res.employee.department).name}${res.integrationsCreated > 0 ? `, with ${res.integrationsCreated} ${res.integrationsCreated === 1 ? 'tool' : 'tools'} from the file` : ''}.`, createdAt: new Date().toISOString() })
        setFocusWorkflow(res.employee.id)
        toast({ title: `${res.employee.name} imported`, description: file.name })
      } catch (e) {
        toast({ title: 'Import failed', description: (e as Error).message, variant: 'destructive' })
      }
    } else {
      // Script → attach for analysis
      setAttachedScript({ name: file.name, content: text, language: detectLanguage(file.name) })
    }
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    const f = e.dataTransfer.files?.[0]
    if (f) onFile(f)
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  const busy = chat.isPending || importEmp.isPending || loopStreaming

  return (
    <div className="flex h-full flex-col" onDragOver={(e) => { e.preventDefault(); setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={onDrop}>
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {dragging && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center border-2 border-dashed border-primary bg-primary/10 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-1 text-primary"><FileJson className="h-8 w-8" /><span className="text-sm font-medium">Drop JSON to import an agent</span></div>
          </div>
        )}
        <div className="mx-auto max-w-3xl px-4 py-4">
          {messages.length === 0 && !showBriefing ? (
            <Greeting onPick={(p) => send(p)} />
          ) : (
            <div className="space-y-4">
              {/* The briefing as the opening secretary message */}
              {showBriefing && (
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                  <div className="flex gap-2.5">
                    <div className="mt-0.5 shrink-0">
                      <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10">
                        <ApicalMark className="h-4 w-4" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1 space-y-2">
                      <BriefingMessage
                        briefing={briefing!}
                        onAction={(a, item, response) => send(`Re: "${item.title}" — ${response}`, [{ id: item.agentId, name: item.agentName, department: '' }])}
                        onViewRun={(runId) => { selectRun(runId); setMode('developer') }}
                        onAsk={(p, ms) => send(p, ms)}
                      />
                    </div>
                  </div>
                </motion.div>
              )}
              <AnimatePresence initial={false}>
                {messages.map((m) => (
                  <motion.div key={m.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
                    <MessageBubble
                      message={m}
                      onClarify={(key, custom) => {
                        if (key.startsWith('suggestion:')) send(key.slice('suggestion:'.length))
                        else if (key === 'skip') send('Actually, skip that — let me try something else.')
                        else {
                          const opt = messages.flatMap((mm) => mm.clarification?.options ?? []).find((o) => o.key === key)
                          send(custom ? `${opt?.label ?? key}: ${custom}` : opt?.label ?? key)
                        }
                      }}
                      onAsk={(p, ms) => send(p, ms)}
                      onViewRun={(runId) => { selectRun(runId); setMode('developer') }}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
              {chat.isPending && (
                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-2.5">
                  <div className="mt-0.5 shrink-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg border border-primary/30 bg-primary/10"><ApicalMark className="h-4 w-4" /></div>
                  </div>
                  <div className="flex flex-col gap-1 rounded-2xl rounded-bl-md border border-border bg-card px-3 py-2">
                    <div className="flex items-center gap-2">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      <span className="text-xs text-muted-foreground">
                        {model === 'thinking' ? 'Reasoning through this…' : 'Thinking…'}
                      </span>
                      <span className="flex gap-1">
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
                        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
                      </span>
                    </div>
                    {model === 'thinking' && (
                      <div className="flex items-center gap-1 pl-5 text-[10px] text-muted-foreground/60">
                        <Brain className="h-2.5 w-2.5" />
                        <span>Chain-of-thought reasoning enabled — this may take longer but produces better results.</span>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-background/80 p-3 backdrop-blur-md">
        <input ref={fileInputRef} type="file" accept=".json,application/json,.py,.js,.mjs,.ts,.sh,.bash,.curl,.http,.rb,.go" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = '' }} />
        {/* Attached script indicator */}
        {attachedScript && (
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-2.5 py-1.5">
            <FileJson className="h-3.5 w-3.5 text-primary" />
            <span className="flex-1 truncate text-xs font-medium">{attachedScript.name}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{attachedScript.language}</span>
            <button onClick={() => setAttachedScript(null)} className="text-muted-foreground hover:text-foreground" aria-label="Remove attachment">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="relative rounded-xl border border-border bg-card focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-colors">
          <MentionComposer
            value={input}
            onChange={setInput}
            onMentionsChange={setMentions}
            mentions={mentions}
            placeholder={attachedScript ? "Ask about this script, or just hit send to analyze it…" : "Message the assistant… use @ to mention an agent"}
            onKeyDown={onKeyDown}
            textareaRef={textareaRef}
            inputClassName="min-h-[48px] max-h-32 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm shadow-none focus:outline-none placeholder:text-muted-foreground"
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-1">
            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => fileInputRef.current?.click()} disabled={busy} title="Attach a JSON agent or a code script">
              <Upload className="h-3.5 w-3.5" />
            </Button>
            <Button size="icon" onClick={() => send(input)} disabled={(!input.trim() && !attachedScript) || busy} className="h-7 w-7 rounded-lg" aria-label="Send">
              {chat.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        {/* Composer footer: model selector + MCP + hints */}
        <div className="mt-1.5 flex items-center gap-2 px-1">
          <ModelSelector value={model} onChange={setModel} />
          <McpConnectButton />
          {loopStreaming && (
            <span className="inline-flex items-center gap-1 text-[10px] text-primary">
              <Loader2 className="h-3 w-3 animate-spin" /> agent working…
            </span>
          )}
          <span className="ml-auto hidden text-[10px] text-muted-foreground sm:inline">
            <kbd className="rounded border border-border px-1 font-mono">Enter</kbd> send · <kbd className="rounded border border-border px-1 font-mono">@</kbd> mention · drop a file
          </span>
        </div>
      </div>
    </div>
  )
}

// ---------------- Model selector (like Cursor) ----------------
const MODELS = [
  { id: 'default', name: 'Apical Default', desc: 'Balanced · fast', thinking: false },
  { id: 'fast', name: 'Fast', desc: 'Quickest · lighter reasoning', thinking: false },
  { id: 'thinking', name: 'Thinking', desc: 'Slowest · best for hard problems', thinking: true },
] as const

function ModelSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = MODELS.find((m) => m.id === value) ?? MODELS[0]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Choose AI model">
          <Sparkles className="h-3 w-3" />
          <span className="font-medium">{current.name}</span>
          <ChevronDown className="h-2.5 w-2.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {MODELS.map((m) => (
          <DropdownMenuItem key={m.id} onClick={() => onChange(m.id)} className="flex-col items-start gap-0 py-1.5">
            <div className="flex w-full items-center gap-1.5">
              <span className={cn('h-2 w-2 rounded-full', m.id === value ? 'bg-primary' : 'bg-transparent border border-border')} />
              <span className="text-xs font-medium">{m.name}</span>
              {m.thinking && <span className="ml-auto rounded bg-reason/15 px-1 py-0.5 text-[9px] text-reason">reasoning</span>}
            </div>
            <span className="pl-3.5 text-[10px] text-muted-foreground">{m.desc}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function McpConnectButton() {
  const [open, setOpen] = React.useState(false)
  const [transport, setTransport] = React.useState<'stdio' | 'http'>('stdio')
  const [name, setName] = React.useState('')
  const [command, setCommand] = React.useState('')
  const [argsStr, setArgsStr] = React.useState('')
  const [url, setUrl] = React.useState('')
  const connect = useConnectMcp()
  const { toast } = useToast()

  const handleConnect = async () => {
    if (!name.trim()) { toast({ title: 'Name required', variant: 'destructive' }); return }
    try {
      const input: Parameters<typeof connect.mutateAsync>[0] = { name: name.trim(), transport }
      if (transport === 'stdio') {
        if (!command.trim()) { toast({ title: 'Command required', variant: 'destructive' }); return }
        input.command = command.trim()
        if (argsStr.trim()) input.args = argsStr.trim().split(/\s+/)
      } else {
        if (!url.trim()) { toast({ title: 'URL required', variant: 'destructive' }); return }
        input.url = url.trim()
      }
      const res = await connect.mutateAsync(input)
      toast({ title: `Connected ${res.integration.name}`, description: `${res.tools.length} tools discovered` })
      setOpen(false); setName(''); setCommand(''); setArgsStr(''); setUrl('')
    } catch (e) {
      toast({ title: 'Connection failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-accent/50 hover:text-foreground" title="Connect an MCP server">
        <Plug className="h-3 w-3" /> MCP
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm"><Plug className="h-4 w-4" /> Connect an MCP server</DialogTitle>
            <DialogDescription className="text-xs">Connect to any Model Context Protocol server. Its tools become available to your agents instantly.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex gap-1 rounded-lg border border-border p-0.5">
              {(['stdio', 'http'] as const).map((t) => (
                <button key={t} onClick={() => setTransport(t)} className={cn('flex-1 rounded-md py-1 text-xs font-medium', transport === t ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground')}>
                  {t === 'stdio' ? 'Local process (stdio)' : 'Remote (HTTP)'}
                </button>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Filesystem, GitHub" className="text-sm" />
            </div>
            {transport === 'stdio' ? (
              <>
                <div className="space-y-1.5">
                  <Label className="text-xs">Command</Label>
                  <Input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="e.g. npx" className="text-sm font-mono" />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Arguments (space-separated)</Label>
                  <Input value={argsStr} onChange={(e) => setArgsStr(e.target.value)} placeholder="e.g. -y @modelcontextprotocol/server-filesystem /tmp" className="text-sm font-mono" />
                </div>
              </>
            ) : (
              <div className="space-y-1.5">
                <Label className="text-xs">Server URL</Label>
                <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://mcp.example.com/sse" className="text-sm font-mono" />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)} className="text-xs">Cancel</Button>
            <Button size="sm" onClick={handleConnect} disabled={connect.isPending} className="text-xs">
              {connect.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Plug className="mr-1 h-3 w-3" />} Connect
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function Greeting({ onPick }: { onPick: (p: string) => void }) {
  const { data: profile } = useProfile()
  const { data: agents } = useWorkflows()
  const name = profile?.companyName
  const agentCount = agents?.length ?? 0
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
        className="mb-3 flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/30 bg-primary/10">
        <ApicalMark className="h-6 w-6" withGlow />
      </motion.div>
      <h2 className="text-base font-semibold tracking-tight">{name ? `Hi — this is your Apical assistant.` : 'How can I help today?'}</h2>
      <p className="mt-1 max-w-md text-xs text-muted-foreground text-balance">
        {agentCount > 0 ? `You have ${agentCount} ${agentCount === 1 ? 'agent' : 'agents'} running. I can set up a new one, tweak an existing one, or just answer questions.` : `Tell me a job to automate, or ask me anything.`}
      </p>
      <div className="mt-5 grid w-full max-w-md grid-cols-1 gap-1.5 text-left">
        {DEFAULT_PROMPTS.map((p) => (
          <button key={p.title} onClick={() => onPick(p.prompt)}
            className="group flex items-start gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-accent/40">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
            <div className="min-w-0 flex-1"><div className="text-xs font-medium">{p.title}</div><div className="text-[11px] text-muted-foreground line-clamp-1">{p.prompt}</div></div>
          </button>
        ))}
        {profile && (
          <button onClick={() => onPick('Based on my setup, what should I automate next?')}
            className="group flex items-start gap-2.5 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-left transition-colors hover:bg-primary/10">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1"><div className="text-xs font-medium">Suggest something for me</div><div className="text-[11px] text-muted-foreground">Tailored to {name ?? 'your setup'}.</div></div>
          </button>
        )}
      </div>
    </div>
  )
}

// ============== ChatTab ==============
export function ChatTab() {
  const leftOpen = useAppStore((s) => s.leftPaneOpen)
  const rightOpen = useAppStore((s) => s.rightPaneOpen)
  const setLeftOpen = useAppStore((s) => s.setLeftPaneOpen)
  const setRightOpen = useAppStore((s) => s.setRightPaneOpen)

  return (
    <div className="flex h-full">
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {leftOpen && (
          <>
            <ResizablePanel defaultSize={18} minSize={14} maxSize={28} collapsible>
              <HistorySidebar />
            </ResizablePanel>
            <ResizableHandle withHandle />
          </>
        )}
        <ResizablePanel defaultSize={leftOpen ? (rightOpen ? 52 : 82) : (rightOpen ? 70 : 100)} minSize={30}>
          <ChatCenter />
        </ResizablePanel>
        {rightOpen && (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={20} maxSize={45} collapsible>
              <WorkflowPane />
            </ResizablePanel>
          </>
        )}
      </ResizablePanelGroup>
      <div className="flex flex-col gap-1 border-l border-border/40 bg-background/40 px-1 py-2">
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setLeftOpen(!leftOpen)} aria-label="Toggle history">
          {leftOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setRightOpen(!rightOpen)} aria-label="Toggle workflow">
          {rightOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
        </Button>
      </div>
    </div>
  )
}
