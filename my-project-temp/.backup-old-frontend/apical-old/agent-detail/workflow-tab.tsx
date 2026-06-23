'use client'

import * as React from 'react'
import { useUpdateWorkflow, useHardenStep, useWorkflows } from '@/lib/queries'
import { useToast } from '@/hooks/use-toast'
import { STEP_KIND_META } from '@/lib/apical'
import type { Workflow, WorkflowStep, StepKind } from '@/lib/types'
import { cn } from '@/lib/utils'
import {
  DndContext, closestCenter, KeyboardSensor, PointerSensor,
  useSensor, useSensors,
} from '@dnd-kit/core'
import {
  arrayMove, SortableContext, sortableKeyboardCoordinates,
  useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import {
  Wrench, Brain, ShieldCheck, Lock, Sparkles, Plus, Trash2,
  ChevronUp, ChevronDown, GripVertical, Play, Pause, Save, Clock,
  Settings as SettingsIcon, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'

const KIND_ICON: Record<StepKind, React.ComponentType<{ className?: string }>> = {
  tool: Wrench,
  reason: Brain,
  gate: ShieldCheck,
  spawn: Sparkles,
}

function SortableStep({ step, index, onUpdate, onDelete }: {
  step: WorkflowStep
  index: number
  onUpdate: (patch: Partial<WorkflowStep>) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: step.id })
  const [editing, setEditing] = React.useState(false)
  const Icon = step.hardened ? Lock : KIND_ICON[step.kind]
  const kindColor = step.hardened ? 'text-hardened'
    : step.kind === 'reason' ? 'text-reason'
    : step.kind === 'gate' ? 'text-gate-foreground'
    : 'text-muted-foreground'

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 'auto',
    opacity: isDragging ? 0.6 : 1,
  }

  return (
    <div ref={setNodeRef} style={style} className={cn(
      'rounded-lg border bg-card p-3 transition-shadow',
      isDragging ? 'shadow-lg border-primary/40' : 'border-border',
    )}>
      <div className="flex items-start gap-2">
        {/* Drag handle */}
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab text-muted-foreground/40 hover:text-muted-foreground active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {/* Kind icon */}
        <div className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border', kindColor,
          step.hardened ? 'border-hardened/40 bg-hardened/10'
          : step.kind === 'reason' ? 'border-reason/40 bg-reason/10'
          : step.kind === 'gate' ? 'border-gate/40 bg-gate/10'
          : 'border-border bg-muted',
        )}>
          <Icon className="h-3.5 w-3.5" />
        </div>

        {/* Content */}
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="space-y-2">
              <Input
                value={step.label}
                onChange={(e) => onUpdate({ label: e.target.value })}
                placeholder="Step label"
                className="h-7 text-sm"
              />
              <Select value={step.kind} onValueChange={(v) => onUpdate({ kind: v as StepKind })}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tool">Tool — mechanical, no AI</SelectItem>
                  <SelectItem value="reason">Reason — AI judgment</SelectItem>
                  <SelectItem value="gate">Gate — human approval</SelectItem>
                </SelectContent>
              </Select>

              {step.kind === 'tool' && (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Tool id</Label>
                  <Input
                    value={step.tool ?? ''}
                    onChange={(e) => onUpdate({ tool: e.target.value })}
                    placeholder="e.g. files.list"
                    className="h-7 font-mono text-xs"
                  />
                </div>
              )}
              {step.kind === 'reason' && (
                <>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Prompt</Label>
                    <Textarea
                      value={step.prompt ?? ''}
                      onChange={(e) => onUpdate({ prompt: e.target.value })}
                      placeholder="What should the AI decide?"
                      rows={2}
                      className="text-xs"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Confidence threshold</Label>
                      <Input
                        type="number"
                        min={0} max={1} step={0.05}
                        value={step.confidenceThreshold ?? 0.8}
                        onChange={(e) => onUpdate({ confidenceThreshold: parseFloat(e.target.value) })}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                </>
              )}
              {step.kind === 'gate' && (
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-wide text-muted-foreground">Gate message</Label>
                  <Textarea
                    value={step.gateMessage ?? ''}
                    onChange={(e) => onUpdate({ gateMessage: e.target.value })}
                    placeholder="What is the human approving?"
                    rows={2}
                    className="text-xs"
                  />
                </div>
              )}

              <div className="flex items-center gap-2">
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)}>
                  Done
                </Button>
                <Button size="sm" variant="ghost" className="ml-auto h-7 text-xs text-destructive" onClick={onDelete}>
                  <Trash2 className="mr-1 h-3 w-3" /> Delete step
                </Button>
              </div>
            </div>
          ) : (
            <button onClick={() => setEditing(true)} className="w-full text-left">
              <div className="flex items-center gap-1.5">
                <span className="text-xs font-medium">{step.label}</span>
                <span className={cn('rounded px-1.5 py-0.5 text-[9px] uppercase', kindColor,
                  step.kind === 'reason' ? 'bg-reason/15'
                  : step.kind === 'gate' ? 'bg-gate/15'
                  : 'bg-muted',
                )}>{step.kind}</span>
                {step.hardened && (
                  <span className="flex items-center gap-0.5 rounded bg-hardened/15 px-1 py-0.5 text-[9px] text-hardened">
                    <Lock className="h-2 w-2" /> hardened
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">
                {step.hardened && step.rule ? <code className="font-mono">{step.rule}</code>
                  : step.kind === 'reason' ? step.prompt
                  : step.kind === 'gate' ? step.gateMessage
                  : step.tool ? <code className="font-mono">{step.tool}</code>
                  : <span className="italic">Click to configure</span>}
              </div>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export function WorkflowTab({ agent }: { agent: Workflow }) {
  const updateWf = useUpdateWorkflow()
  const harden = useHardenStep()
  const { toast } = useToast()
  const [localSteps, setLocalSteps] = React.useState<WorkflowStep[]>(agent.steps.steps)
  const [dirty, setDirty] = React.useState(false)

  // Reset when the agent changes.
  React.useEffect(() => {
    setLocalSteps(agent.steps.steps)
    setDirty(false)
  }, [agent.id, agent.steps.steps])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (event: { active: { id: string | number }; over: { id: string | number } | null }) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setLocalSteps((steps) => {
      const oldIndex = steps.findIndex((s) => s.id === active.id)
      const newIndex = steps.findIndex((s) => s.id === over.id)
      if (oldIndex === -1 || newIndex === -1) return steps
      const moved = arrayMove(steps, oldIndex, newIndex)
      // Re-index ids.
      return moved.map((s, i) => ({ ...s, id: `s${i + 1}` }))
    })
    setDirty(true)
  }

  const updateStep = (id: string, patch: Partial<WorkflowStep>) => {
    setLocalSteps((steps) => steps.map((s) => (s.id === id ? { ...s, ...patch } : s)))
    setDirty(true)
  }

  const deleteStep = (id: string) => {
    setLocalSteps((steps) => {
      const filtered = steps.filter((s) => s.id !== id)
      return filtered.map((s, i) => ({ ...s, id: `s${i + 1}` }))
    })
    setDirty(true)
  }

  const addStep = (kind: StepKind) => {
    const newId = `s${localSteps.length + 1}`
    const newStep: WorkflowStep = {
      id: newId,
      kind,
      label: kind === 'tool' ? 'New tool step' : kind === 'reason' ? 'New reason step' : 'New gate',
      ...(kind === 'tool' ? { tool: '' } : {}),
      ...(kind === 'reason' ? { prompt: '', confidenceThreshold: 0.8 } : {}),
      ...(kind === 'gate' ? { gateMessage: '' } : {}),
    }
    setLocalSteps((steps) => [...steps, newStep])
    setDirty(true)
  }

  const save = async () => {
    try {
      await updateWf.mutateAsync({
        id: agent.id,
        patch: { steps: { version: 1, steps: localSteps } },
      })
      setDirty(false)
      toast({ title: 'Workflow saved' })
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const toggleStatus = async () => {
    try {
      await updateWf.mutateAsync({
        id: agent.id,
        patch: { status: agent.status === 'paused' ? 'active' : 'paused' },
      })
      toast({ title: agent.status === 'paused' ? 'Resumed' : 'Paused' })
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  const updateTrigger = async (trigger: 'manual' | 'schedule', schedule?: string) => {
    try {
      await updateWf.mutateAsync({
        id: agent.id,
        patch: { trigger, schedule: trigger === 'schedule' ? (schedule ?? agent.schedule ?? 'Every day at 9am') : null },
      })
    } catch (e) {
      toast({ title: 'Failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Wrench className="h-4 w-4 text-muted-foreground" /> Workflow
          </h2>
          <p className="text-[11px] text-muted-foreground">
            What {agent.name} does, step by step. Drag to reorder. Click a step to edit.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {dirty && (
            <Button size="sm" onClick={save} disabled={updateWf.isPending}>
              {updateWf.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
              Save
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={toggleStatus}>
            {agent.status === 'paused' ? <Play className="mr-1 h-3 w-3" /> : <Pause className="mr-1 h-3 w-3" />}
            {agent.status === 'paused' ? 'Resume' : 'Pause'}
          </Button>
        </div>
      </div>

      {/* Trigger + schedule */}
      <div className="rounded-lg border border-border bg-card p-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          <Clock className="h-3 w-3" /> Trigger & schedule
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Trigger</Label>
            <Select value={agent.trigger} onValueChange={(v) => updateTrigger(v as 'manual' | 'schedule')}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual — run on demand</SelectItem>
                <SelectItem value="schedule">Schedule — runs automatically</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {agent.trigger === 'schedule' && (
            <div className="space-y-1">
              <Label className="text-[11px]">Schedule</Label>
              <Input
                defaultValue={agent.schedule ?? ''}
                onBlur={(e) => updateTrigger('schedule', e.target.value || undefined)}
                placeholder="Every day at 9am"
                className="h-8 text-xs"
              />
              <p className="text-[10px] text-muted-foreground">Human-readable. e.g. "Every weekday at 9am", "Every hour".</p>
            </div>
          )}
        </div>
      </div>

      {/* Step flow */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <SettingsIcon className="h-3 w-3" /> Steps ({localSteps.length})
          </h3>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addStep('tool')}>
              <Wrench className="mr-1 h-3 w-3" /> Tool
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addStep('reason')}>
              <Brain className="mr-1 h-3 w-3" /> Reason
            </Button>
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => addStep('gate')}>
              <ShieldCheck className="mr-1 h-3 w-3" /> Gate
            </Button>
          </div>
        </div>

        {localSteps.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
            No steps yet. Add a tool, reason, or gate step above to get started.
          </div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={localSteps.map((s) => s.id)} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {localSteps.map((step, i) => (
                  <React.Fragment key={step.id}>
                    <SortableStep
                      step={step}
                      index={i}
                      onUpdate={(patch) => updateStep(step.id, patch)}
                      onDelete={() => deleteStep(step.id)}
                    />
                    {i < localSteps.length - 1 && (
                      <div className="flex justify-center">
                        <ChevronDown className="h-3 w-3 text-muted-foreground/40" />
                      </div>
                    )}
                  </React.Fragment>
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="mt-3 flex items-center gap-1 px-1 text-[10px] text-muted-foreground">
          <Plus className="h-2.5 w-2.5" />
          Add steps with the buttons above. Steps pass data via {' '}
          <code className="rounded bg-muted px-1 font-mono">{'{{stepId.field}}'}</code> references.
        </div>
      </div>
    </div>
  )
}
