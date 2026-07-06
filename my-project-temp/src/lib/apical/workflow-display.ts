import type { WorkflowStep } from '@/lib/types'

// ---------------- Schedule display ----------------
//
// Users should never see raw cron outside the schedule editor. A workflow's
// `schedule` field can hold a bare cron ("0 8 * * 1"), a "Cron: ..." editor
// label, a friendly editor label ("Daily at 09:00"), or natural language
// ("every day at 9am"). humanizeSchedule() renders any of these as plain
// English and, crucially, never returns a raw cron expression.

const DOW_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DOW_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`
}

function formatClock(minute: number, hour: number): string {
  const period = hour < 12 ? 'AM' : 'PM'
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}:${String(minute).padStart(2, '0')} ${period}`
}

/** Friendly text for a cron day-of-week field, or null if too exotic. */
function describeDow(field: string): string | null {
  if (field === '1-5') return 'Weekdays'
  if (field === '0,6' || field === '6,0' || field === '0,7') return 'Weekends'
  if (/^[0-7]$/.test(field)) return `${DOW_NAMES[Number(field) % 7]}s`
  if (/^[0-7](,[0-7])+$/.test(field)) return field.split(',').map((d) => DOW_SHORT[Number(d) % 7]).join(', ')
  return null
}

/** True if the string is shaped like a 5-field cron expression. */
function looksLikeCron(s: string): boolean {
  const parts = s.trim().split(/\s+/)
  return parts.length === 5 && parts.every((p) => /^[\d*/,-]+$/.test(p))
}

/** Turn a 5-field cron expression into friendly text, or null if too exotic. */
function describeCron(expr: string): string | null {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [min, hour, dom, mon, dow] = parts

  const everyMin = min.match(/^\*\/(\d+)$/)
  if (everyMin && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    const n = Number(everyMin[1])
    return n <= 1 ? 'Every minute' : `Every ${n} minutes`
  }
  if (min === '*' && hour === '*' && dom === '*' && mon === '*' && dow === '*') return 'Every minute'

  const everyHour = hour.match(/^\*\/(\d+)$/)
  if (/^\d+$/.test(min) && everyHour && dom === '*' && mon === '*' && dow === '*') {
    const n = Number(everyHour[1])
    return n <= 1 ? 'Every hour' : `Every ${n} hours`
  }
  if (/^\d+$/.test(min) && hour === '*' && dom === '*' && mon === '*' && dow === '*') {
    return Number(min) === 0 ? 'Every hour' : `Hourly at :${String(Number(min)).padStart(2, '0')}`
  }

  if (/^\d+$/.test(min) && /^\d+$/.test(hour) && mon === '*') {
    const time = formatClock(Number(min), Number(hour))
    if (dom === '*' && dow === '*') return `Daily at ${time}`
    if (dom === '*' && dow !== '*') {
      const d = describeDow(dow)
      return d ? `${d} at ${time}` : `Weekly at ${time}`
    }
    if (dom !== '*' && dow === '*') {
      return /^\d+$/.test(dom) ? `Monthly on the ${ordinal(Number(dom))} at ${time}` : `Monthly at ${time}`
    }
  }

  return null
}

/**
 * Non-technical rendering of a workflow's `schedule` field for display outside
 * the schedule editor. Never returns a raw cron expression: cron-shaped input
 * (bare or "Cron: ..."-labeled) is converted to English, falling back to
 * "On a custom schedule" when too exotic to phrase; friendly/natural-language
 * values pass through unchanged.
 */
export function humanizeSchedule(schedule: string | null | undefined): string {
  const raw = (schedule ?? '').trim()
  if (!raw) return 'Scheduled'

  const fixed = raw.match(/^fixed_rate:(\d+)$/)
  if (fixed) {
    const secs = Number(fixed[1])
    if (secs % 3600 === 0) { const h = secs / 3600; return h === 1 ? 'Every hour' : `Every ${h} hours` }
    if (secs % 60 === 0) { const m = secs / 60; return m === 1 ? 'Every minute' : `Every ${m} minutes` }
    return `Every ${secs} seconds`
  }

  const labeled = raw.match(/^cron:\s*(.+)$/i)
  if (labeled) {
    const inner = labeled[1].trim()
    return looksLikeCron(inner) ? (describeCron(inner) ?? 'On a custom schedule') : inner
  }

  if (looksLikeCron(raw)) return describeCron(raw) ?? 'On a custom schedule'

  return raw
}

/** Secondary line for workflow UI — paths, commands, script preview. */
export function workflowStepDetail(step: WorkflowStep): string | null {
  if (step.code?.source) {
    const line = step.code.source.split('\n').find((l) => l.trim()) ?? step.code.source
    return `${step.code.language}: ${line.length > 100 ? line.slice(0, 100) + '…' : line}`
  }
  if (step.mcp?.tool) {
    return `MCP ${step.mcp.tool}${step.mcp.integrationId ? ` (${step.mcp.integrationId.slice(0, 8)}…)` : ''}`
  }
  if (step.http?.url) return step.http.url
  const inputs = step.inputs ?? {}
  if (typeof inputs.path === 'string' && inputs.path) return inputs.path
  if (typeof inputs.from === 'string' && typeof inputs.to === 'string') {
    return `${inputs.from} → ${inputs.to}`
  }
  if (typeof inputs.command === 'string') {
    const args = Array.isArray(inputs.args) ? inputs.args.map(String).join(' ') : ''
    return `${inputs.command}${args ? ` ${args}` : ''}`.trim()
  }
  if (typeof inputs.code === 'string' && inputs.code) {
    const line = inputs.code.split('\n').find((l) => l.trim()) ?? inputs.code
    return line.length > 100 ? `${line.slice(0, 100)}…` : line
  }
  if (typeof inputs.query === 'string') return inputs.query
  if (typeof inputs.url === 'string') return inputs.url
  return null
}

/** Friendly tool badge (not raw snake_case). */
export function workflowStepToolLabel(step: WorkflowStep): string {
  if (step.hardened) return 'Automated'
  if (step.code) return 'Code'
  if (step.mcp) return 'MCP'
  if (step.http) return 'API'
  if (step.integrationId) return 'Integration'
  switch (step.tool) {
    case 'fs_list':
      return 'List folder'
    case 'fs_read':
      return 'Read file'
    case 'fs_write':
      return 'Write file'
    case 'fs_move':
      return 'Move file'
    case 'cli_run':
      return 'Shell'
    case 'script_run':
      return 'Script'
    case 'http':
      return 'API call'
    default:
      return step.tool?.replace(/_/g, ' ') ?? 'Step'
  }
}
