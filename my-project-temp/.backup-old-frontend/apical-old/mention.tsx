'use client'

import * as React from 'react'
import { useWorkflows } from '@/lib/queries'
import { useAppStore } from '@/lib/store'
import { agentInitials, agentAvatarLightness, departmentMeta } from '@/lib/apical'
import type { Workflow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { motion, AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'

export interface Mention {
  id: string
  name: string
  title?: string | null
  department: string
}

/** A clickable @mention chip rendered inline in the chat input + messages. */
export function MentionChip({
  mention,
  onRemove,
  onClick,
  size = 'md',
}: {
  mention: Mention
  onRemove?: () => void
  onClick?: () => void
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md bg-primary/15 text-primary font-medium',
        size === 'sm' ? 'px-1 py-0 text-[11px]' : 'px-1.5 py-0.5 text-xs',
      )}
    >
      <span
        role={onClick ? 'button' : undefined}
        onClick={onClick}
        className="flex items-center gap-1"
      >
        <span
          className={cn('flex items-center justify-center rounded-full font-semibold text-primary-foreground', size === 'sm' ? 'h-3.5 w-3.5 text-[8px]' : 'h-4 w-4 text-[9px]')}
          style={{ backgroundColor: `oklch(${agentAvatarLightness(mention.name)} 0.08 155)` }}
        >
          {agentInitials(mention.name)}
        </span>
        @{mention.name}
      </span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-0.5 rounded-sm hover:bg-primary/20"
          aria-label={`Remove @${mention.name}`}
        >
          <X className={size === 'sm' ? 'h-2.5 w-2.5' : 'h-3 w-3'} />
        </button>
      )}
    </span>
  )
}

/** The @mention picker popover that appears when the user types @ */
export function MentionPicker({
  query,
  onPick,
  onClose,
  position,
}: {
  query: string
  onPick: (agent: Workflow) => void
  onClose: () => void
  position: { top: number; left: number }
}) {
  const { data: agents } = useWorkflows()
  const activeWorkspaceId = useAppStore((s) => s.activeWorkspaceId)

  const filtered = React.useMemo(() => {
    if (!agents) return []
    const q = query.toLowerCase()
    const inWs = agents.filter((a) => !activeWorkspaceId || !a.workspaceId || a.workspaceId === activeWorkspaceId)
    const others = agents.filter((a) => activeWorkspaceId && a.workspaceId && a.workspaceId !== activeWorkspaceId)
    const all = [...inWs, ...others]
    return all.filter((a) =>
      !q ||
      a.name.toLowerCase().includes(q) ||
      (a.title ?? '').toLowerCase().includes(q) ||
      a.department.toLowerCase().includes(q),
    ).slice(0, 8)
  }, [agents, query, activeWorkspaceId])

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute z-50 w-64 overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        style={{ top: position.top, left: position.left }}
      >
        <div className="border-b border-border px-2.5 py-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          Mention an agent
        </div>
        <div className="max-h-60 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-2.5 py-2 text-xs text-muted-foreground">No agents found.</div>
          ) : (
            filtered.map((a) => {
              const dept = departmentMeta(a.department)
              return (
                <button
                  key={a.id}
                  onClick={() => onPick(a)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent/60"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-primary-foreground"
                    style={{ backgroundColor: `oklch(${agentAvatarLightness(a.name)} 0.08 155)` }}
                  >
                    {agentInitials(a.name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{a.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {a.title ? `${a.title} · ` : ''}{dept.name}
                    </div>
                  </div>
                  {activeWorkspaceId && a.workspaceId && a.workspaceId !== activeWorkspaceId && (
                    <span className="rounded bg-muted px-1 py-0.5 text-[9px] text-muted-foreground">other ws</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </motion.div>
    </>
  )
}

/**
 * A composer input that supports @mention chips inline. The chips are rendered
 * as tokens above a hidden text input; the visible text is what the user types.
 * Mentions are tracked separately and sent alongside the message.
 */
export function MentionComposer({
  value,
  onChange,
  onMentionsChange,
  placeholder,
  onKeyDown,
  textareaRef,
  inputClassName,
  mentions,
}: {
  value: string
  onChange: (v: string) => void
  onMentionsChange: (m: Mention[]) => void
  placeholder: string
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
  inputClassName?: string
  mentions: Mention[]
}) {
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [pickerQuery, setPickerQuery] = React.useState('')
  const [pickerPos, setPickerPos] = React.useState({ top: 0, left: 0 })
  const pendingMentions = React.useRef<Mention[]>(mentions)

  React.useEffect(() => {
    pendingMentions.current = mentions
  }, [mentions])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value
    onChange(newVal)
    // Detect @ at the start of a word (preceded by space or start)
    const cursor = e.target.selectionStart
    const before = newVal.slice(0, cursor)
    const match = before.match(/(?:^|\s)@([\w-]*)$/)
    if (match) {
      setPickerQuery(match[1])
      setPickerOpen(true)
      // Position the picker above the textarea
      const ta = e.target
      const rect = ta.getBoundingClientRect()
      setPickerPos({ top: -8, left: 16 })
      void rect
    } else {
      setPickerOpen(false)
    }
  }

  const handlePick = (agent: Workflow) => {
    // Remove the @query from the text, and add the mention chip.
    const cursor = textareaRef.current?.selectionStart ?? value.length
    const before = value.slice(0, cursor)
    const after = value.slice(cursor)
    const match = before.match(/(?:^|\s)@([\w-]*)$/)
    if (match) {
      const cutBefore = before.slice(0, before.length - match[0].length)
      const newValue = cutBefore + (cutBefore && !cutBefore.endsWith(' ') ? ' ' : '') + after
      onChange(newValue)
      const newMentions = [...pendingMentions.current.filter((m) => m.id !== agent.id), {
        id: agent.id, name: agent.name, title: agent.title, department: agent.department,
      }]
      onMentionsChange(newMentions)
    }
    setPickerOpen(false)
    setTimeout(() => textareaRef.current?.focus(), 0)
  }

  const removeMention = (id: string) => {
    onMentionsChange(pendingMentions.current.filter((m) => m.id !== id))
  }

  return (
    <div className="relative">
      {/* Mention chips row */}
      {mentions.length > 0 && (
        <div className="flex flex-wrap gap-1 px-3 pt-2">
          <AnimatePresence>
            {mentions.map((m) => (
              <motion.span key={m.id} initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }}>
                <MentionChip mention={m} onRemove={() => removeMention(m.id)} size="sm" />
              </motion.span>
            ))}
          </AnimatePresence>
        </div>
      )}
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className={inputClassName}
      />
      {pickerOpen && (
        <MentionPicker
          query={pickerQuery}
          onPick={handlePick}
          onClose={() => setPickerOpen(false)}
          position={pickerPos}
        />
      )}
    </div>
  )
}
