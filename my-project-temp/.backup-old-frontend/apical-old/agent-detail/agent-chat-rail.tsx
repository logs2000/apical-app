'use client'

import * as React from 'react'
import { useAppStore } from '@/lib/store'
import { useAgentMessages, useSaveAgentMessage } from '@/lib/queries'
import type { Workflow, AgentEvent, AgentMessage } from '@/lib/types'
import { AgentChatPanel } from '../agent-chat-panel'
import { agentInitials, agentAvatarLightness } from '@/lib/apical'
import { cn } from '@/lib/utils'
import { ChevronRight, MessageSquare, X } from 'lucide-react'

/** Right-side collapsible chat rail. Wraps the existing AgentChatPanel and
 *  persists messages via the /api/agents/[id]/messages endpoint. */
export function AgentChatRail({ agent }: { agent: Workflow }) {
  const open = useAppStore((s) => s.agentChatRailOpen)
  const setOpen = useAppStore((s) => s.setAgentChatRailOpen)
  const { data: persistedMessages, isLoading } = useAgentMessages(agent.id)
  const saveMessage = useSaveAgentMessage(agent.id)

  // Track whether we've hydrated the panel with persisted messages.
  // We do this once per agent id change.
  const [hydrated, setHydrated] = React.useState<string | null>(null)
  React.useEffect(() => {
    setHydrated(null)
  }, [agent.id])

  // The AgentChatPanel uses internal state. We can't directly inject messages
  // without refactoring it, so we'll wrap it: when the panel mounts, if there
  // are persisted messages, we'd ideally pass them in. For now, we render the
  // panel and let it manage its own state — persistence happens via the
  // onSend/onReceive hooks below.
  //
  // This is a pragmatic tradeoff: the panel already streams + renders events
  // correctly. Persistence is added via the wrapper, not by refactoring the
  // panel's internals.

  return (
    <>
      {/* Collapsed strip */}
      {!open && (
        <div className="flex h-full w-10 flex-col items-center gap-2 border-l border-border bg-sidebar/20 py-2">
          <button
            onClick={() => setOpen(true)}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
            title="Expand chat"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setOpen(true)}
            className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
            style={{ backgroundColor: `oklch(${agentAvatarLightness(agent.name)} 0.06 155)` }}
            title={`Chat with ${agent.name}`}
          >
            {agentInitials(agent.name)}
          </button>
          <div className="mt-1 [writing-mode:vertical-rl] text-[9px] uppercase tracking-wide text-muted-foreground">
            Chat
          </div>
        </div>
      )}

      {/* Expanded rail */}
      {open && (
        <div className="flex h-full flex-col border-l border-border bg-background">
          {/* Top bar: agent name + collapse */}
          <div className="flex items-center gap-2 border-b border-border px-2 py-1.5">
            <MessageSquare className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Chat</span>
            <button
              onClick={() => setOpen(false)}
              className="ml-auto flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent/50 hover:text-foreground"
              title="Collapse chat"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* The panel itself */}
          <div className="min-h-0 flex-1">
            <AgentChatPanel
              agent={agent}
              persistedMessages={persistedMessages}
              onMessagePersist={(msg) => {
                // Fire-and-forget; we don't need to await.
                saveMessage.mutate({
                  role: msg.role,
                  content: msg.content,
                  events: msg.events,
                })
              }}
            />
          </div>
        </div>
      )}
    </>
  )
}
