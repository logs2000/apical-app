'use client'

import * as React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { computeNextRun, parseFixedRate, type ScheduleKind } from '@/lib/platform/cron'
import { Loader2, Play, Pause, SkipForward, Save, CalendarClock, Check } from 'lucide-react'

// ─── Types ───────────────────────────────────────────────────────────────────

type Frequency = 'minutes' | 'hourly' | 'daily' | 'weekly' | 'custom'

interface JobDto {
  id: string
  workflowId: string
  schedule: string
  scheduleKind: string
  timezone: string
  status: string
  nextRunAt: string
  lastRunAt: string | null
  lastRunStatus: string | null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const FREQ_LABELS: Record<Frequency, string> = {
  minutes: 'Every few minutes',
  hourly: 'Hourly',
  daily: 'Daily',
  weekly: 'Weekly',
  custom: 'Custom (cron)',
}

const TIME_PRESETS = [
  { label: '6:00 AM', hour: 6, minute: 0 },
  { label: '9:00 AM', hour: 9, minute: 0 },
  { label: '12:00 PM', hour: 12, minute: 0 },
  { label: '5:00 PM', hour: 17, minute: 0 },
  { label: '9:00 PM', hour: 21, minute: 0 },
] as const

// ─── Local-time → UTC cron helpers ─────────────────────────────────────────────

function browserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

function localHmToUtc(hour: number, minute: number): { hour: number; minute: number } {
  const d = new Date()
  d.setHours(hour, minute, 0, 0)
  return { hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

function localWeeklyToUtc(
  weekday: number,
  hour: number,
  minute: number,
): { weekday: number; hour: number; minute: number } {
  const d = new Date()
  const delta = (weekday - d.getDay() + 7) % 7
  d.setDate(d.getDate() + delta)
  d.setHours(hour, minute, 0, 0)
  return { weekday: d.getUTCDay(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

interface SchedRule {
  frequency: Frequency
  everyMinutes: number
  minute: number
  hour: number
  weekday: number
  cron: string
}

const DEFAULT_RULE: SchedRule = {
  frequency: 'daily',
  everyMinutes: 15,
  minute: 0,
  hour: 9,
  weekday: 1,
  cron: '0 9 * * *',
}

function ruleToSchedule(rule: SchedRule): { schedule: string; scheduleKind: ScheduleKind } {
  switch (rule.frequency) {
    case 'minutes':
      return { schedule: `fixed_rate:${Math.max(1, rule.everyMinutes) * 60}`, scheduleKind: 'fixed_rate' }
    case 'hourly':
      return { schedule: `${rule.minute} * * * *`, scheduleKind: 'cron' }
    case 'daily': {
      const u = localHmToUtc(rule.hour, rule.minute)
      return { schedule: `${u.minute} ${u.hour} * * *`, scheduleKind: 'cron' }
    }
    case 'weekly': {
      const u = localWeeklyToUtc(rule.weekday, rule.hour, rule.minute)
      return { schedule: `${u.minute} ${u.hour} * * ${u.weekday}`, scheduleKind: 'cron' }
    }
    case 'custom':
      return { schedule: rule.cron.trim(), scheduleKind: 'cron' }
  }
}

function ruleLabel(rule: SchedRule): string {
  const t = `${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')}`
  switch (rule.frequency) {
    case 'minutes':
      return `Every ${rule.everyMinutes} min`
    case 'hourly':
      return `Hourly at :${String(rule.minute).padStart(2, '0')}`
    case 'daily':
      return `Daily at ${t}`
    case 'weekly':
      return `Weekly ${WEEKDAYS[rule.weekday]} ${t}`
    case 'custom':
      return `Cron: ${rule.cron.trim()}`
  }
}

function scheduleToRule(schedule: string, kind: string): SchedRule {
  const rule = { ...DEFAULT_RULE }
  if (kind === 'fixed_rate') {
    const secs = parseFixedRate(schedule)
    if (secs) {
      rule.frequency = 'minutes'
      rule.everyMinutes = Math.max(1, Math.round(secs / 60))
      return rule
    }
  }
  const parts = schedule.trim().split(/\s+/)
  if (parts.length === 5) {
    const [min, hr, dom, , dow] = parts
    if (hr === '*' && dom === '*' && dow === '*' && /^\d+$/.test(min)) {
      rule.frequency = 'hourly'
      rule.minute = Number(min)
      return rule
    }
    if (/^\d+$/.test(min) && /^\d+$/.test(hr) && dom === '*') {
      const d = new Date()
      d.setUTCHours(Number(hr), Number(min), 0, 0)
      rule.hour = d.getHours()
      rule.minute = d.getMinutes()
      if (dow === '*') {
        rule.frequency = 'daily'
      } else if (/^\d+$/.test(dow)) {
        rule.frequency = 'weekly'
        rule.weekday = d.getDay()
      }
      return rule
    }
  }
  rule.frequency = 'custom'
  rule.cron = schedule
  return rule
}

function formatWhen(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function rulesEqual(a: SchedRule, b: SchedRule): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function ScheduleEditor({
  workflowId,
  compact = false,
  autoSave = true,
}: {
  workflowId: string
  /** Tighter layout for the inspector overview rail. */
  compact?: boolean
  /** Persist schedule changes automatically after edits (when a job exists). */
  autoSave?: boolean
}) {
  const [rule, setRule] = React.useState<SchedRule>(DEFAULT_RULE)
  const [savedRule, setSavedRule] = React.useState<SchedRule>(DEFAULT_RULE)
  const [job, setJob] = React.useState<JobDto | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [busy, setBusy] = React.useState<null | 'save' | 'run' | 'toggle' | 'skip'>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [savedFlash, setSavedFlash] = React.useState(false)
  const tz = React.useMemo(browserTimezone, [])

  const loadJob = React.useCallback(async () => {
    try {
      const res = await fetch('/api/scheduler/jobs', { credentials: 'include' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const rows = (await res.json()) as JobDto[]
      const mine = rows.find((r) => r.workflowId === workflowId) ?? null
      setJob(mine)
      if (mine) {
        const loaded = scheduleToRule(mine.schedule, mine.scheduleKind)
        setRule(loaded)
        setSavedRule(loaded)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load schedule')
    } finally {
      setLoading(false)
    }
  }, [workflowId])

  React.useEffect(() => {
    void loadJob()
  }, [loadJob])

  const preview = React.useMemo(() => {
    try {
      const { schedule, scheduleKind } = ruleToSchedule(rule)
      if (scheduleKind === 'cron' && schedule.trim().split(/\s+/).length !== 5) return null
      return computeNextRun(schedule, scheduleKind, 'UTC')
    } catch {
      return null
    }
  }, [rule])

  const dirty = !rulesEqual(rule, savedRule)

  const saveSchedule = React.useCallback(async () => {
    setBusy('save')
    setError(null)
    try {
      const { schedule, scheduleKind } = ruleToSchedule(rule)
      const res = await fetch('/api/scheduler/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ workflowId, schedule, scheduleKind, timezone: tz }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      void fetch(`/v1/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ trigger: 'schedule', schedule: ruleLabel(rule) }),
      }).catch(() => {})
      setSavedRule(rule)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
      await loadJob()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save schedule')
    } finally {
      setBusy(null)
    }
  }, [loadJob, rule, tz, workflowId])

  // Auto-save when the user adjusts time/frequency (debounced).
  React.useEffect(() => {
    if (!autoSave || loading || !dirty || busy !== null) return
    const t = setTimeout(() => {
      void saveSchedule()
    }, compact ? 600 : 900)
    return () => clearTimeout(t)
  }, [autoSave, busy, compact, dirty, loading, rule, saveSchedule])

  async function jobAction(kind: 'run' | 'toggle' | 'skip') {
    if (!job) return
    setBusy(kind)
    setError(null)
    try {
      if (kind === 'run') {
        await fetch(`/api/scheduler/jobs/${job.id}/run`, { method: 'POST', credentials: 'include' })
      } else if (kind === 'skip') {
        await fetch(`/api/scheduler/jobs/${job.id}/skip`, { method: 'POST', credentials: 'include' })
      } else {
        await fetch(`/api/scheduler/jobs/${job.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ status: job.status === 'paused' ? 'active' : 'paused' }),
        })
      }
      await loadJob()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const paused = job?.status === 'paused'

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading schedule…
      </div>
    )
  }

  return (
    <div className={cn('space-y-3', compact && 'space-y-2.5')}>
      {job && (
        <div
          className={cn(
            'flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2',
            compact && 'px-2.5 py-1.5',
          )}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs">
              <span
                className={cn(
                  'inline-flex h-2 w-2 shrink-0 rounded-full',
                  paused ? 'bg-amber-500' : 'bg-emerald-500',
                )}
              />
              <span className="font-medium">{paused ? 'Paused' : 'Active'}</span>
              {dirty && (
                <span className="text-[10px] text-muted-foreground">· unsaved</span>
              )}
              {savedFlash && (
                <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 dark:text-emerald-400">
                  <Check className="h-3 w-3" /> Saved
                </span>
              )}
            </div>
            <div className="mt-0.5 truncate text-[10px] text-muted-foreground">
              Next: {formatWhen(job.nextRunAt)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            <button
              type="button"
              title="Run now"
              disabled={busy !== null}
              onClick={() => void jobAction('run')}
              className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
            >
              {busy === 'run' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              title="Skip next run"
              disabled={busy !== null || paused}
              onClick={() => void jobAction('skip')}
              className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
            >
              {busy === 'skip' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SkipForward className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              title={paused ? 'Resume' : 'Pause'}
              disabled={busy !== null}
              onClick={() => void jobAction('toggle')}
              className="rounded p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
            >
              {busy === 'toggle' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="text-xs">How often</Label>
        <div className={cn('grid gap-1', compact ? 'grid-cols-3' : 'grid-cols-5')}>
          {(Object.keys(FREQ_LABELS) as Frequency[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setRule((r) => ({ ...r, frequency: f }))}
              className={cn(
                'rounded-md border px-1.5 py-1.5 text-[10px] font-medium transition-colors',
                rule.frequency === f
                  ? 'border-foreground/20 bg-muted text-foreground'
                  : 'border-border text-muted-foreground hover:bg-surface-hover',
              )}
            >
              {f === 'minutes' ? 'Minutes' : f === 'custom' ? 'Cron' : FREQ_LABELS[f].split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {rule.frequency === 'minutes' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Run every (minutes)</Label>
          <Input
            type="number"
            min={1}
            value={rule.everyMinutes}
            onChange={(e) =>
              setRule((r) => ({ ...r, everyMinutes: Math.max(1, Number(e.target.value) || 1) }))
            }
            className="h-9 text-sm"
          />
        </div>
      )}

      {rule.frequency === 'hourly' && (
        <div className="space-y-1.5">
          <Label className="text-xs">At minute past the hour</Label>
          <Input
            type="number"
            min={0}
            max={59}
            value={rule.minute}
            onChange={(e) =>
              setRule((r) => ({
                ...r,
                minute: Math.min(59, Math.max(0, Number(e.target.value) || 0)),
              }))
            }
            className="h-9 text-sm"
          />
        </div>
      )}

      {(rule.frequency === 'daily' || rule.frequency === 'weekly') && (
        <div className="space-y-2">
          {rule.frequency === 'weekly' && (
            <div className="space-y-1.5">
              <Label className="text-xs">On day</Label>
              <div className="flex flex-wrap gap-1">
                {WEEKDAYS.map((d, i) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setRule((r) => ({ ...r, weekday: i }))}
                    className={cn(
                      'rounded-md border px-2 py-1 text-[10px] font-medium transition-colors',
                      rule.weekday === i
                        ? 'border-foreground/20 bg-muted text-foreground'
                        : 'border-border text-muted-foreground hover:bg-surface-hover',
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <Label className="text-xs">At time ({tz})</Label>
            <Input
              type="time"
              value={`${String(rule.hour).padStart(2, '0')}:${String(rule.minute).padStart(2, '0')}`}
              onChange={(e) => {
                const [h, m] = e.target.value.split(':').map((v) => Number(v) || 0)
                setRule((r) => ({ ...r, hour: h, minute: m }))
              }}
              className="h-9 text-sm"
            />
          </div>
          {!compact && (
            <div className="flex flex-wrap gap-1">
              {TIME_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => setRule((r) => ({ ...r, hour: p.hour, minute: p.minute }))}
                  className={cn(
                    'rounded-md border px-2 py-0.5 text-[10px] transition-colors',
                    rule.hour === p.hour && rule.minute === p.minute
                      ? 'border-foreground/20 bg-muted text-foreground'
                      : 'border-border text-muted-foreground hover:bg-surface-hover',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {rule.frequency === 'custom' && (
        <div className="space-y-1.5">
          <Label className="text-xs">Cron expression (UTC, 5-field)</Label>
          <Input
            value={rule.cron}
            onChange={(e) => setRule((r) => ({ ...r, cron: e.target.value }))}
            placeholder="0 9 * * 1-5"
            className="h-9 font-mono text-sm"
          />
        </div>
      )}

      <div className="flex items-center gap-1.5 rounded-md border border-dashed border-border px-3 py-2 text-[11px] text-muted-foreground">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" />
        {preview ? (
          <span>
            Next run{' '}
            <span className="font-medium text-foreground">{formatWhen(preview.toISOString())}</span>
          </span>
        ) : (
          <span>Enter a valid schedule to preview the next run.</span>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/10 p-2 text-[11px] text-orange-950 dark:text-orange-100">
          {error}
        </div>
      )}

      {!autoSave && (
        <Button
          size="sm"
          className="w-full gap-1.5"
          onClick={() => void saveSchedule()}
          disabled={busy !== null || !dirty}
        >
          {busy === 'save' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          {job ? 'Update schedule' : 'Set schedule'}
        </Button>
      )}

      {autoSave && dirty && busy === 'save' && (
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Saving…
        </div>
      )}
    </div>
  )
}
