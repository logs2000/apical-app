// Apical — cron / fixed-rate schedule parser + next-run computer.
//
// Used by:
//   - src/app/api/scheduler/jobs/* (when creating/updating jobs)
//   - mini-services/scheduler/index.ts (after a fire, to compute nextRunAt)
//
// Supported schedule shapes:
//   - fixed_rate: "<seconds>" e.g. "fixed_rate:60" → fire every 60 seconds
//   - cron: 5-field expressions, with these supported subsets:
//       * * * * *           (every minute)
//       */N * * * *         (every N minutes / hours)
//       M H * * *           (daily at H:M, 24h)
//       M H * * D           (weekly at H:M on weekday D, 0=Sun..6=Sat)
//       0 0 * * *           (midnight daily)
//       0 0 1 * *           (monthly on day 1 at midnight)
//     Field meanings (in order): minute hour day-of-month month day-of-week
//     For unsupported / unparseable crons, we fall back to `now + 1h` so a bad
//     expression never silently turns into a tight loop.
//
// Timezones: the helper accepts an optional `timezone` string. We don't pull in
// a full tz database — instead, if the tz is "UTC" (or missing) we operate in
// UTC. For any other tz, we still operate in UTC but the caller is expected to
// have normalized. In practice Apical stores everything in UTC.

export type ScheduleKind = 'cron' | 'fixed_rate'

const FALLBACK_SECONDS = 3600 // 1 hour — used when a cron can't be parsed

/** Parse `fixed_rate:<seconds>` → seconds, or null if malformed. */
export function parseFixedRate(schedule: string): number | null {
  const m = /^fixed_rate:(\d+)$/.exec(schedule.trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
}

interface CronFields {
  minute: number[]      // 0-59
  hour: number[]        // 0-23
  dayOfMonth: number[]  // 1-31
  month: number[]       // 1-12
  dayOfWeek: number[]   // 0-6 (0 = Sunday)
}

const DAY_NAMES: Record<string, number> = {
  sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6,
}
const MONTH_NAMES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
}

// Parse a single cron field: "5", "star-slash-15", "1,2,3", "1-5", "*" → list of ints.
function parseField(raw: string, min: number, max: number, names?: Record<string, number>): number[] | null {
  const field = raw.trim().toLowerCase()
  if (field === '*') {
    const out: number[] = []
    for (let i = min; i <= max; i++) out.push(i)
    return out
  }
  // */N
  const stepMatch = /^\*\/(\d+)$/.exec(field)
  if (stepMatch) {
    const step = parseInt(stepMatch[1], 10)
    if (!step || step <= 0) return null
    const out: number[] = []
    for (let i = min; i <= max; i += step) out.push(i)
    return out
  }
  // Range with optional step: a-b or a-b/N
  const rangeMatch = /^(\d+)-(\d+)(?:\/(\d+))?$/.exec(field)
  if (rangeMatch) {
    const lo = parseInt(rangeMatch[1], 10)
    const hi = parseInt(rangeMatch[2], 10)
    const step = rangeMatch[3] ? parseInt(rangeMatch[3], 10) : 1
    if (lo < min || hi > max || lo > hi || step <= 0) return null
    const out: number[] = []
    for (let i = lo; i <= hi; i += step) out.push(i)
    return out
  }
  // Comma list of single values / ranges (e.g. "1,5,10" or "1-3,15")
  if (field.includes(',')) {
    const parts = field.split(',')
    const out: number[] = []
    for (const part of parts) {
      const sub = parseField(part, min, max, names)
      if (!sub) return null
      out.push(...sub)
    }
    // dedupe + sort
    return Array.from(new Set(out)).sort((a, b) => a - b)
  }
  // Single value (number or name)
  let v: number
  if (/^\d+$/.test(field)) {
    v = parseInt(field, 10)
  } else if (names && field in names) {
    v = names[field]
  } else {
    return null
  }
  if (v < min || v > max) return null
  return [v]
}

/** Parse a 5-field cron expression. Returns null if unparseable. */
export function parseCron(schedule: string): CronFields | null {
  const parts = schedule.trim().split(/\s+/)
  if (parts.length !== 5) return null
  const [minF, hourF, domF, monF, dowF] = parts
  const minute = parseField(minF, 0, 59)
  const hour = parseField(hourF, 0, 23)
  const dayOfMonth = parseField(domF, 1, 31)
  const month = parseField(monF, 1, 12, MONTH_NAMES)
  const dayOfWeek = parseField(dowF, 0, 6, DAY_NAMES)
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null
  return { minute, hour, dayOfMonth, month, dayOfWeek }
}

/** True if the given Date matches the cron fields. */
function matchesCron(date: Date, f: CronFields): boolean {
  if (!f.minute.includes(date.getUTCMinutes())) return false
  if (!f.hour.includes(date.getUTCHours())) return false
  if (!f.month.includes(date.getUTCMonth() + 1)) return false
  // Cron semantics: if both day-of-month and day-of-week are restricted (i.e.
  // not "*"), match if EITHER matches. If only one is restricted, that one
  // must match. If both are "*", both match trivially.
  const domStar = f.dayOfMonth.length === 31
  const dowStar = f.dayOfWeek.length === 7
  const domMatch = f.dayOfMonth.includes(date.getUTCDate())
  // JS getUTCDay: 0 = Sunday, matches our convention.
  const dowMatch = f.dayOfWeek.includes(date.getUTCDay())
  if (domStar && dowStar) {
    // both unrestricted
  } else if (!domStar && !dowStar) {
    if (!domMatch && !dowMatch) return false
  } else {
    if (!domMatch || !dowMatch) {
      // exactly one is restricted; the restricted one must match
      if (!domStar && !domMatch) return false
      if (!dowStar && !dowMatch) return false
    }
  }
  return true
}

/**
 * Compute the next run time after `from` for the given schedule.
 *
 * `schedule` is either `fixed_rate:<seconds>` or a 5-field cron expression.
 * `kind` selects the parser. `timezone` is currently informational (everything
 * is UTC) but accepted for API compatibility.
 *
 * Returns a Date in UTC. On unparseable input, falls back to `from + 1h` so a
 * bad schedule never results in a busy loop.
 */
export function computeNextRun(
  schedule: string,
  kind: ScheduleKind,
  timezone?: string,
  from: Date = new Date(),
): Date {
  // fixed_rate is easy.
  if (kind === 'fixed_rate') {
    const secs = parseFixedRate(schedule)
    if (secs == null) {
      return new Date(from.getTime() + FALLBACK_SECONDS * 1000)
    }
    return new Date(from.getTime() + secs * 1000)
  }

  // cron: walk forward minute-by-minute up to 366 days. If nothing matches in
  // that window, fall back to `from + 1h` (avoids infinite loops on weird
  // expressions like "0 0 31 2 *").
  const fields = parseCron(schedule)
  if (!fields) {
    return new Date(from.getTime() + FALLBACK_SECONDS * 1000)
  }

  // Start at the next whole minute after `from`.
  const start = new Date(from.getTime())
  start.setUTCSeconds(0, 0)
  start.setUTCMinutes(start.getUTCMinutes() + 1)

  const maxSteps = 366 * 24 * 60 // ~527k minutes — about a year
  for (let i = 0; i < maxSteps; i++) {
    if (matchesCron(start, fields)) {
      return start
    }
    start.setUTCMinutes(start.getUTCMinutes() + 1)
  }
  // No match within a year — fall back.
  return new Date(from.getTime() + FALLBACK_SECONDS * 1000)
}

/** Validate a schedule string. Returns a human-readable error or null if OK. */
export function validateSchedule(schedule: string, kind: ScheduleKind): string | null {
  if (!schedule || typeof schedule !== 'string') return 'schedule is required'
  if (kind === 'fixed_rate') {
    const secs = parseFixedRate(schedule)
    if (secs == null) return 'fixed_rate schedule must look like "fixed_rate:<seconds>"'
    if (secs < 5) return 'fixed_rate minimum is 5 seconds'
    return null
  }
  if (kind === 'cron') {
    if (!parseCron(schedule)) return 'cron must be 5 fields: minute hour day-of-month month day-of-week'
    return null
  }
  return `unknown scheduleKind: ${kind}`
}
