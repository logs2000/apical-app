'use client'

import * as React from 'react'
import { useUpdateWorkflow, useSuggestConfig, useIntegrations, useCredentials } from '@/lib/queries'
import { useToast } from '@/hooks/use-toast'
import type { Workflow } from '@/lib/types'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Slider } from '@/components/ui/slider'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Settings, User, Cpu, Clock, KeyRound, Sparkles, Loader2,
  Save, Brain, ShieldCheck, Plug, Lock,
} from 'lucide-react'

const MODELS = [
  { id: 'default', name: 'Apical Default', desc: 'Balanced · fast' },
  { id: 'fast', name: 'Fast', desc: 'Quickest · lighter reasoning' },
  { id: 'thinking', name: 'Thinking', desc: 'Slowest · best for hard problems' },
] as const

function Section({ icon: Icon, title, desc, children }: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  desc?: string
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-start gap-2">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {desc && <p className="text-[11px] text-muted-foreground">{desc}</p>}
        </div>
      </div>
      {children}
    </div>
  )
}

export function ConfigTab({ agent }: { agent: Workflow }) {
  const updateWf = useUpdateWorkflow()
  const suggest = useSuggestConfig(agent.id)
  const { data: integrations } = useIntegrations()
  const { data: credentials } = useCredentials()
  const { toast } = useToast()

  // Local form state, synced to the agent when it changes.
  const [name, setName] = React.useState(agent.name)
  const [title, setTitle] = React.useState(agent.title ?? '')
  const [department, setDepartment] = React.useState(agent.department)
  const [description, setDescription] = React.useState(agent.description)
  const [runtime, setRuntime] = React.useState<'local' | 'hosted'>(agent.runtime ?? 'hosted')
  const [trigger, setTrigger] = React.useState<'manual' | 'schedule'>(agent.trigger)
  const [schedule, setSchedule] = React.useState(agent.schedule ?? '')
  const [status, setStatus] = React.useState<'active' | 'paused' | 'draft'>(agent.status)
  const [modelPref, setModelPref] = React.useState<string>(agent.modelPreference ?? 'inherit')
  const [confThreshold, setConfThreshold] = React.useState(agent.confidenceThreshold ?? 0.8)
  const [autoHarden, setAutoHarden] = React.useState(agent.autoHardenAfter ?? 0)
  const [allowedTools, setAllowedTools] = React.useState<Set<string>>(new Set(agent.allowedTools ?? []))
  const [allowedCreds, setAllowedCreds] = React.useState<Set<string>>(new Set(agent.allowedCredentials ?? []))
  const [saving, setSaving] = React.useState(false)

  React.useEffect(() => {
    setName(agent.name)
    setTitle(agent.title ?? '')
    setDepartment(agent.department)
    setDescription(agent.description)
    setRuntime(agent.runtime ?? 'hosted')
    setTrigger(agent.trigger)
    setSchedule(agent.schedule ?? '')
    setStatus(agent.status)
    setModelPref(agent.modelPreference ?? 'inherit')
    setConfThreshold(agent.confidenceThreshold ?? 0.8)
    setAutoHarden(agent.autoHardenAfter ?? 0)
    setAllowedTools(new Set(agent.allowedTools ?? []))
    setAllowedCreds(new Set(agent.allowedCredentials ?? []))
  }, [agent.id, agent.name, agent.title, agent.department, agent.description, agent.runtime, agent.trigger, agent.schedule, agent.status, agent.modelPreference, agent.confidenceThreshold, agent.autoHardenAfter, agent.allowedTools, agent.allowedCredentials])

  const save = async () => {
    setSaving(true)
    try {
      await updateWf.mutateAsync({
        id: agent.id,
        patch: {
          name: name.trim() || agent.name,
          title: title.trim() || null,
          department: department.trim() || 'General',
          description,
          runtime: runtime as 'hosted' | 'local',
          trigger: trigger as 'manual' | 'schedule',
          schedule: trigger === 'schedule' ? (schedule || null) : null,
          status: status as 'active' | 'paused' | 'draft',
          modelPreference: modelPref === 'inherit' ? null : modelPref,
          confidenceThreshold: confThreshold,
          autoHardenAfter: autoHarden,
          allowedTools: Array.from(allowedTools),
          allowedCredentials: Array.from(allowedCreds),
        },
      })
      toast({ title: 'Configuration saved' })
    } catch (e) {
      toast({ title: 'Save failed', description: (e as Error).message, variant: 'destructive' })
    } finally {
      setSaving(false)
    }
  }

  const runSuggest = async () => {
    try {
      const s = await suggest.mutateAsync()
      if (s.schedule) { setTrigger('schedule'); setSchedule(s.schedule) }
      if (s.modelPreference) setModelPref(s.modelPreference)
      if (s.confidenceThreshold !== null) setConfThreshold(s.confidenceThreshold)
      if (s.autoHardenAfter !== null) setAutoHarden(s.autoHardenAfter)
      toast({
        title: 'Applied AI suggestion',
        description: s.reasoning,
      })
    } catch (e) {
      toast({ title: 'Suggestion failed', description: (e as Error).message, variant: 'destructive' })
    }
  }

  // Build tool list from integrations.
  const allTools = React.useMemo(() => {
    const list: { id: string; integration: string; description: string }[] = []
    for (const it of integrations ?? []) {
      for (const t of it.tools) {
        list.push({ id: t.id, integration: it.name, description: t.description })
      }
    }
    return list
  }, [integrations])

  const toggleTool = (id: string) => {
    setAllowedTools((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleCred = (id: string) => {
    setAllowedCreds((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold tracking-tight">
            <Settings className="h-4 w-4 text-muted-foreground" /> Configuration
          </h2>
          <p className="text-[11px] text-muted-foreground">Identity, runtime, AI behavior, and connections.</p>
        </div>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={runSuggest}
            disabled={suggest.isPending}
          >
            {suggest.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Sparkles className="mr-1 h-3 w-3" />}
            Suggest settings
          </Button>
          <Button size="sm" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
            Save
          </Button>
        </div>
      </div>

      {/* Identity */}
      <Section icon={User} title="Identity" desc="How this agent is referred to across the workspace.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Title</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Filing Agent" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Department</Label>
            <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g. Filing" className="h-8 text-sm" />
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as 'active' | 'paused' | 'draft')}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="paused">Paused</SelectItem>
                <SelectItem value="draft">Draft</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label className="text-[11px]">Description</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="What this agent does, in one or two sentences."
              className="text-xs"
            />
          </div>
        </div>
      </Section>

      {/* Runtime */}
      <Section icon={Cpu} title="Runtime" desc="Where this agent runs and how often.">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label className="text-[11px]">Runtime</Label>
            <Select value={runtime} onValueChange={(v) => setRuntime(v as 'local' | 'hosted')}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hosted">Hosted — runs on Apical servers</SelectItem>
                <SelectItem value="local">Local — runs on your desktop (fs/cli/net access)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[11px]">Trigger</Label>
            <Select value={trigger} onValueChange={(v) => setTrigger(v as 'manual' | 'schedule')}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="manual">Manual — run on demand</SelectItem>
                <SelectItem value="schedule">Schedule — runs automatically</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {trigger === 'schedule' && (
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-[11px]">Schedule</Label>
              <Input
                value={schedule}
                onChange={(e) => setSchedule(e.target.value)}
                placeholder="Every day at 9am"
                className="h-8 text-sm"
              />
              <p className="text-[10px] text-muted-foreground">
                Human-readable. We&apos;ll parse common patterns (daily/weekly/hourly).
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* AI behavior */}
      <Section icon={Brain} title="AI behavior" desc="How the agent reasons and learns.">
        <div className="space-y-4">
          <div className="space-y-1">
            <Label className="text-[11px]">Model preference</Label>
            <Select value={modelPref} onValueChange={(v) => setModelPref(v)}>
              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="inherit">Inherit workspace default</SelectItem>
                {MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>{m.name} — {m.desc}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px]">Confidence threshold</Label>
              <span className="font-mono text-xs tabular-nums">{confThreshold.toFixed(2)}</span>
            </div>
            <Slider
              value={[confThreshold]}
              min={0} max={1} step={0.05}
              onValueChange={(v) => setConfThreshold(v[0])}
            />
            <p className="text-[10px] text-muted-foreground">
              Reason steps below this confidence are flagged for review. Default 0.80.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-[11px]">Auto-harden after N consistent runs</Label>
              <span className="font-mono text-xs tabular-nums">{autoHarden}</span>
            </div>
            <Slider
              value={[autoHarden]}
              min={0} max={20} step={1}
              onValueChange={(v) => setAutoHarden(v[0])}
            />
            <p className="text-[10px] text-muted-foreground">
              When a reason step produces the same output N times in a row, propose hardening it to a rule. 0 = off.
            </p>
          </div>
        </div>
      </Section>

      {/* Connections — allowed tools */}
      <Section icon={Plug} title="Allowed tools" desc="Which connected tools this agent can use. Empty = all.">
        {allTools.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No tools connected. Visit Settings → Connections to add some.</p>
        ) : (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {allTools.map((t) => {
              const checked = allowedTools.size === 0 || allowedTools.has(t.id)
              return (
                <label key={t.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 px-2 py-1.5 hover:bg-accent/30">
                  <Switch
                    checked={checked}
                    onCheckedChange={() => toggleTool(t.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <code className="font-mono text-[11px]">{t.id}</code>
                      <span className="rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">{t.integration}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground line-clamp-1">{t.description}</div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
        <p className="mt-2 text-[10px] text-muted-foreground">
          {allowedTools.size === 0
            ? 'Currently: all tools allowed (default).'
            : `Currently: ${allowedTools.size} tool${allowedTools.size === 1 ? '' : 's'} allowed.`}
        </p>
      </Section>

      {/* Connections — allowed credentials */}
      <Section icon={KeyRound} title="Allowed credentials" desc="Which vault credentials this agent can access. Empty = all.">
        {!credentials || credentials.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">No credentials in the vault yet.</p>
        ) : (
          <div className="max-h-48 space-y-1 overflow-y-auto">
            {credentials.map((c) => {
              const checked = allowedCreds.size === 0 || allowedCreds.has(c.id)
              return (
                <label key={c.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border/60 px-2 py-1.5 hover:bg-accent/30">
                  <Switch
                    checked={checked}
                    onCheckedChange={() => toggleCred(c.id)}
                    className="mt-0.5"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <Lock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-xs font-medium">{c.label}</span>
                      <span className="rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">{c.kind}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">{c.service}</div>
                  </div>
                </label>
              )
            })}
          </div>
        )}
      </Section>
    </div>
  )
}
