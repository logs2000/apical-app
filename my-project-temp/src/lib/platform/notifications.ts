// Apical — email notifications.
//
// Drives the outbound email layer: gate approvals, flagged items, daily briefs,
// schedule outcomes, billing receipts, system notices. Every send writes an
// EmailLog row first (status='queued'), then attempts the actual SMTP send (or,
// in dev with no SMTP_URI, just logs the would-be send and marks it 'sent').
//
// SMTP transport is a zero-dependency minimal SMTPS client built on Node's
// `net` + `tls` modules — parses `smtps://user:pass@host:465` style URIs and
// runs the EHLO → AUTH LOGIN → MAIL FROM → RCPT TO → DATA → QUIT sequence. We
// avoid pulling in nodemailer to keep the dependency surface small. If the
// send fails for any reason, the EmailLog row is marked 'failed' with the
// error message and the caller still gets the row back (so the in-app
// notification center + downstream retries can pick it up).
//
// Per-user notification preferences live on UserProfile.notificationPrefsJson:
//   { gate, flagged, daily_brief, weekly_brief, schedule, billing } → boolean
// Empty object {} = all on. If a kind is explicitly `false`, sendEmail()
// short-circuits: creates an EmailLog row with status='skipped' and returns it
// without attempting a send.

import { Buffer } from 'buffer'
import { connect as netConnect, Socket } from 'net'
import { connect as tlsConnect, TLSSocket } from 'tls'
import { db } from '@/lib/db'
import type { EmailLog } from '@prisma/client'

// ---------------- Types ----------------

export type EmailKind = EmailLog['kind'] // 'gate'|'flagged'|'daily_brief'|'weekly_brief'|'schedule'|'billing'|'system'

export type NotificationPrefKey =
  | 'gate'
  | 'flagged'
  | 'daily_brief'
  | 'weekly_brief'
  | 'schedule'
  | 'billing'

export type NotificationPrefs = Record<NotificationPrefKey, boolean>

export interface SendEmailParams {
  userId: string
  to: string
  subject: string
  body: string
  kind: EmailKind
  refId?: string | null
}

export interface GateNotifyInput {
  workflowName: string
  stepLabel: string
  runId: string
  summary?: string
}

export interface FlaggedNotifyInput {
  workflowName: string
  runId: string
  items: Array<{ title: string; detail?: string }>
}

export interface ScheduleNotifyInput {
  workflowName: string
  runId: string
  status: 'success' | 'failed' | 'timeout'
  summary?: string
}

export interface DailyBrief {
  subject: string
  body: string
  html: string
}

// ---------------- Notification preferences ----------------

/** All known notification keys, in display order. */
export const NOTIFICATION_PREF_KEYS: NotificationPrefKey[] = [
  'gate',
  'flagged',
  'daily_brief',
  'weekly_brief',
  'schedule',
  'billing',
]

/**
 * Read the user's notification preferences. Returns a complete prefs object —
 * any key not explicitly set in the stored JSON defaults to `true` (opt-in by
 * default; only an explicit `false` disables a kind).
 */
export async function getNotificationPrefs(
  userId: string,
): Promise<NotificationPrefs> {
  const profile = await db.userProfile.findUnique({
    where: { userId },
    select: { notificationPrefsJson: true },
  })
  return parsePrefs(profile?.notificationPrefsJson)
}

/** Parse a stored prefs JSON string into a complete prefs object. */
export function parsePrefs(raw: string | null | undefined): NotificationPrefs {
  const defaults: NotificationPrefs = {
    gate: true,
    flagged: true,
    daily_brief: true,
    weekly_brief: true,
    schedule: true,
    billing: true,
  }
  if (!raw) return defaults
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return defaults
    const out: NotificationPrefs = { ...defaults }
    for (const key of NOTIFICATION_PREF_KEYS) {
      const v = parsed[key]
      if (typeof v === 'boolean') out[key] = v
    }
    return out
  } catch {
    return defaults
  }
}

/**
 * Merge the given partial prefs into the stored JSON for the user. Only the
 * keys supplied are changed; others are preserved. Creates a UserProfile row
 * if the user doesn't have one yet.
 */
export async function setNotificationPrefs(
  userId: string,
  prefs: Partial<NotificationPrefs>,
): Promise<NotificationPrefs> {
  const current = await getNotificationPrefs(userId)
  const merged: NotificationPrefs = { ...current }
  for (const key of NOTIFICATION_PREF_KEYS) {
    const v = prefs[key]
    if (typeof v === 'boolean') merged[key] = v
  }
  // Upsert UserProfile — there's a unique constraint on userId.
  await db.userProfile.upsert({
    where: { userId },
    update: { notificationPrefsJson: JSON.stringify(merged) },
    create: {
      userId,
      notificationPrefsJson: JSON.stringify(merged),
    },
  })
  return merged
}

// ---------------- SMTP transport (zero-dep) ----------------

interface SmtpConfig {
  secure: boolean // true = smtps (implicit TLS); false = smtp (plain, STARTTLS upgraded if available)
  host: string
  port: number
  user?: string
  pass?: string
}

/**
 * Parse `smtps://user:pass@host:465` (or `smtp://...`) into a config object.
 * Returns null on a malformed URI.
 */
function parseSmtpUri(uri: string): SmtpConfig | null {
  const trimmed = uri.trim()
  if (!trimmed) return null
  let u: URL
  try {
    u = new URL(trimmed)
  } catch {
    return null
  }
  const secure = u.protocol === 'smtps:'
  if (u.protocol !== 'smtps:' && u.protocol !== 'smtp:') return null
  if (!u.hostname) return null
  const port = u.port ? parseInt(u.port, 10) : secure ? 465 : 587
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null
  const user = u.username ? decodeURIComponent(u.username) : undefined
  const pass = u.password ? decodeURIComponent(u.password) : undefined
  return { secure, host: u.hostname, port, user, pass }
}

/**
 * A minimal line-oriented SMTP client. Connects via TLS (smtps) or plain TCP
 * (smtp, optional STARTTLS upgrade), runs EHLO → optional AUTH LOGIN → MAIL
 * FROM → RCPT TO → DATA → QUIT. Throws on any protocol-level error so the
 * caller can mark the EmailLog row 'failed'.
 */
class SmtpClient {
  private sock: Socket | TLSSocket
  private buffer = ''
  private readonly timeout = 15_000

  private constructor(sock: Socket | TLSSocket) {
    this.sock = sock
  }

  static async connect(cfg: SmtpConfig): Promise<SmtpClient> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => reject(err)
      const onTimeout = () => reject(new Error('SMTP connect timeout'))
      const baseSock = cfg.secure
        ? tlsConnect({ host: cfg.host, port: cfg.port, servername: cfg.host, rejectUnauthorized: true })
        : netConnect({ host: cfg.host, port: cfg.port })
      baseSock.setTimeout(cfg.secure ? 15_000 : 10_000)
      baseSock.once('error', onError)
      baseSock.once('timeout', onTimeout)
      baseSock.once('secureConnect', () => {
        if (cfg.secure) {
          baseSock.removeAllListeners('error')
          baseSock.removeAllListeners('timeout')
          resolve(new SmtpClient(baseSock as TLSSocket))
        }
      })
      baseSock.once('connect', () => {
        if (!cfg.secure) {
          baseSock.removeAllListeners('error')
          baseSock.removeAllListeners('timeout')
          resolve(new SmtpClient(baseSock))
        }
      })
    })
  }

  /** Read the server's next complete reply (one or more lines, joined). */
  private readReply(): Promise<string> {
    return new Promise((resolve, reject) => {
      const onTimeout = () => {
        this.sock.off('data', onData)
        reject(new Error('SMTP read timeout'))
      }
      const onData = (chunk: Buffer) => {
        this.buffer += chunk.toString('utf8')
        // A reply ends when a line starts with "NNN " (3-digit code + space).
        // Intermediate lines start with "NNN-".
        const lines = this.buffer.split('\r\n')
        // Keep the last partial line in the buffer.
        const last = lines.pop() ?? ''
        this.buffer = last
        for (const line of lines) {
          if (/^\d{3} /.test(line)) {
            this.sock.off('data', onData)
            this.sock.off('timeout', onTimeout)
            // Re-join the consumed reply so the caller sees the full text.
            // (We only need the final code line for branching, but include
            // earlier lines for diagnostics.)
            resolve(line)
            return
          }
        }
      }
      this.sock.once('timeout', onTimeout)
      this.sock.on('data', onData)
    })
  }

  /** Send a single command + CRLF. */
  private async sendCmd(cmd: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.sock.write(cmd + '\r\n', 'utf8', (err) => (err ? reject(err) : resolve()))
    })
  }

  /** Send a command and read the reply; throw if the status code isn't expected. */
  private async command(cmd: string, expect: number): Promise<string> {
    await this.sendCmd(cmd)
    const reply = await this.readReply()
    const code = parseInt(reply.slice(0, 3), 10)
    if (!Number.isFinite(code) || code !== expect) {
      throw new Error(`SMTP ${cmd.split(' ')[0]} failed: ${reply}`)
    }
    return reply
  }

  /** Upgrade a plain TCP connection to TLS via STARTTLS. */
  private async starttls(host: string): Promise<void> {
    const reply = await this.command('STARTTLS', 220)
    void reply
    return new Promise((resolve, reject) => {
      const tlsSock = tlsConnect({
        socket: this.sock,
        servername: host,
        rejectUnauthorized: true,
      })
      tlsSock.once('secureConnect', () => {
        this.sock = tlsSock
        this.buffer = ''
        resolve()
      })
      tlsSock.once('error', reject)
      tlsSock.setTimeout(this.timeout, () => reject(new Error('SMTP STARTTLS timeout')))
    })
  }

  /**
   * Run the full SMTP send sequence. Throws on any failure (the caller marks
   * the EmailLog row 'failed' with the error message).
   */
  async send(cfg: SmtpConfig, from: string, to: string, raw: string): Promise<void> {
    // 1. Server greeting (220).
    await this.readReply().then((reply) => {
      const code = parseInt(reply.slice(0, 3), 10)
      if (code !== 220) throw new Error(`SMTP greeting unexpected: ${reply}`)
    })

    // 2. EHLO.
    const ehloReply = await this.command(`EHLO ${cfg.host}`, 250)

    // 3. STARTTLS if plain + the server advertises it.
    if (!cfg.secure && /(^|\n)250[ -]STARTTLS/.test(ehloReply)) {
      await this.starttls(cfg.host)
      // Re-issue EHLO over the encrypted channel (required by RFC 3207).
      await this.command(`EHLO ${cfg.host}`, 250)
    }

    // 4. AUTH LOGIN if creds are present + the server advertises AUTH.
    if (cfg.user && cfg.pass) {
      const authAdvertised = /(^|\n)250[ -]AUTH\b/i.test(
        cfg.secure ? await this.readEhloAuth() : ehloReply,
      )
      // Note: after STARTTLS we already re-EHLO'd above; for the implicit-TLS
      // path we use the first EHLO reply. If AUTH isn't advertised we skip
      // authentication (some servers accept anonymous relay).
      if (authAdvertised || cfg.secure) {
        try {
          await this.command('AUTH LOGIN', 334)
          await this.command(Buffer.from(cfg.user, 'utf8').toString('base64'), 334)
          await this.command(Buffer.from(cfg.pass, 'utf8').toString('base64'), 235)
        } catch (err) {
          // If auth fails (e.g. server doesn't actually accept AUTH), rethrow
          // with a clearer message.
          throw new Error(
            `SMTP AUTH LOGIN failed: ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      }
    }

    // 5. MAIL FROM / RCPT TO / DATA / QUIT.
    await this.command(`MAIL FROM:<${from}>`, 250)
    await this.command(`RCPT TO:<${to}>`, 250)
    await this.command('DATA', 354)
    // The body must have CRLF line endings + any line starting with "." gets
    // an extra "." prepended (dot-stuffing per RFC 5321 § 4.5.2).
    const stuffed = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
      .map((l) => (l.startsWith('.') ? '.' + l : l))
      .join('\r\n')
    await this.sendCmd(stuffed + '\r\n.')
    await this.readReply().then((reply) => {
      const code = parseInt(reply.slice(0, 3), 10)
      if (code !== 250) throw new Error(`SMTP DATA rejected: ${reply}`)
    })
    try {
      await this.command('QUIT', 221)
    } catch {
      // QUIT failures are non-fatal — the message is already queued.
    }
  }

  /** Issue a fresh EHLO and read just enough to detect AUTH advertisement. */
  private async readEhloAuth(): Promise<string> {
    // We already issued EHLO twice in the STARTTLS path; just probe AUTH by
    // issuing a no-op EHLO and parsing the reply. (Cheaper than maintaining
    // the multi-line buffer across the TLS upgrade.)
    await this.sendCmd(`EHLO ${this.sock.remoteAddress || 'apical.local'}`)
    // Drain lines until the final "250 " line.
    let last = ''
    for (let i = 0; i < 20; i++) {
      const reply = await this.readReply()
      last = reply
      if (/^250 /.test(reply)) break
    }
    return last
  }

  close(): void {
    try {
      this.sock.end()
    } catch {
      // Ignore.
    }
  }
}

/**
 * Send a single email via SMTP. Returns void on success, throws on failure.
 * No-op-safe: if SMTP_URI is empty, the caller should have already short-
 * circuited via the dev log-only path.
 */
async function deliverViaSmtp(
  from: string,
  to: string,
  raw: string,
): Promise<void> {
  const uri = process.env.SMTP_URI || ''
  const cfg = parseSmtpUri(uri)
  if (!cfg) {
    throw new Error(`Invalid SMTP_URI (cannot parse)`)
  }
  const client = await SmtpClient.connect(cfg)
  try {
    await client.send(cfg, from, to, raw)
  } finally {
    client.close()
  }
}

// ---------------- Core: sendEmail ----------------

function getFromEmail(): string {
  return process.env.NOTIFICATIONS_FROM_EMAIL?.trim() || 'notifications@apic.al'
}

function isSmtpConfigured(): boolean {
  const uri = (process.env.SMTP_URI || '').trim()
  if (!uri) return false
  return parseSmtpUri(uri) !== null
}

/**
 * Build the raw RFC 5322 message (headers + body) for an email. We keep this
 * minimal: From, To, Subject, MIME-Version, Content-Type, Date.
 */
function buildRawMessage(from: string, to: string, subject: string, body: string): string {
  const date = new Date().toUTCString()
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, 'utf8').toString('base64')}?=`
  // Encode body as UTF-8; normalize line endings to CRLF.
  const normalizedBody = body.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n/g, '\r\n')
  return [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    `MIME-Version: 1.0`,
    `Content-Type: text/plain; charset=UTF-8`,
    `Content-Transfer-Encoding: 8bit`,
    `Date: ${date}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@apical.local>`,
    ``,
    normalizedBody,
  ].join('\r\n')
}

/**
 * Send an email. Respects the user's per-kind notification preferences:
 * if `kind` is explicitly `false` in their prefs, creates an EmailLog row
 * with status='skipped' and returns it without attempting a send.
 *
 * Otherwise: creates EmailLog(status='queued'), attempts the actual send
 * (SMTP if configured, log-only otherwise), and updates the row's status to
 * 'sent' (with sentAt) or 'failed' (with errorMessage). Always returns the
 * EmailLog row so callers can log it / surface it in the notification center.
 */
export async function sendEmail(p: SendEmailParams): Promise<EmailLog> {
  // 1. Check prefs — short-circuit if explicitly disabled.
  const prefs = await getNotificationPrefs(p.userId)
  const prefKey = p.kind as NotificationPrefKey
  if (NOTIFICATION_PREF_KEYS.includes(prefKey) && prefs[prefKey] === false) {
    return await db.emailLog.create({
      data: {
        userId: p.userId,
        toAddress: p.to,
        subject: p.subject,
        body: p.body,
        kind: p.kind,
        status: 'skipped',
        refId: p.refId ?? null,
      },
    })
  }

  // 2. Create the queued row.
  const row = await db.emailLog.create({
    data: {
      userId: p.userId,
      toAddress: p.to,
      subject: p.subject,
      body: p.body,
      kind: p.kind,
      status: 'queued',
      refId: p.refId ?? null,
    },
  })

  // 3. Attempt the send.
  try {
    const from = getFromEmail()
    if (isSmtpConfigured()) {
      const raw = buildRawMessage(from, p.to, p.subject, p.body)
      await deliverViaSmtp(from, p.to, raw)
    } else {
      // Dev / log-only mode: SMTP_URI is empty (or unparseable). Don't
      // attempt a send — just log it for the developer + mark as 'sent'.
      console.log(
        `[notifications] (dev, not sent) ${p.kind} → ${p.to}: ${p.subject}`,
      )
    }
    return await db.emailLog.update({
      where: { id: row.id },
      data: { status: 'sent', sentAt: new Date() },
    })
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err)
    console.error(`[notifications] send failed for ${row.id}:`, errorMessage)
    return await db.emailLog.update({
      where: { id: row.id },
      data: { status: 'failed', errorMessage },
    })
  }
}

// ---------------- Specific notification builders ----------------

/** Resolve the user's email address (used as the default `to`). */
async function getUserEmail(userId: string): Promise<string | null> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  })
  return u?.email ?? null
}

/** Resolve the user's display name (preferred over email in greetings). */
async function getUserName(userId: string): Promise<string> {
  const u = await db.user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  })
  if (!u) return 'there'
  if (u.name && u.name.trim()) return u.name.trim().split(/\s+/)[0]
  if (u.email) return u.email.split('@')[0]
  return 'there'
}

/**
 * Notify a user that a gate step in a workflow run is awaiting their approval.
 */
export async function notifyGate(
  userId: string,
  input: GateNotifyInput,
): Promise<EmailLog> {
  const to = await getUserEmail(userId)
  if (!to) {
    return await db.emailLog.create({
      data: {
        userId,
        toAddress: '(no email on file)',
        subject: `Approval needed: ${input.stepLabel} in ${input.workflowName}`,
        body: 'User has no email address on file.',
        kind: 'gate',
        status: 'skipped',
        refId: input.runId,
      },
    })
  }
  const firstName = await getUserName(userId)
  const subject = `Approval needed: ${input.stepLabel} in ${input.workflowName}`
  const lines = [
    `Hi ${firstName},`,
    ``,
    `An agent run hit a gate that needs your sign-off before it can continue.`,
    ``,
    `  Workflow: ${input.workflowName}`,
    `  Step:     ${input.stepLabel}`,
    `  Run:      ${input.runId}`,
  ]
  if (input.summary && input.summary.trim()) {
    lines.push(``, `Summary:`, `  ${input.summary.trim()}`)
  }
  lines.push(
    ``,
    `Open Apical to review and approve (or reject) this step.`,
    ``,
    `— The Apical team`,
  )
  return await sendEmail({
    userId,
    to,
    subject,
    body: lines.join('\n'),
    kind: 'gate',
    refId: input.runId,
  })
}

/**
 * Notify a user about flagged items in a workflow run. Renders a bulleted list
 * of the flagged items (title + optional detail).
 */
export async function notifyFlagged(
  userId: string,
  input: FlaggedNotifyInput,
): Promise<EmailLog> {
  const to = await getUserEmail(userId)
  if (!to) {
    return await db.emailLog.create({
      data: {
        userId,
        toAddress: '(no email on file)',
        subject: `Flagged items in ${input.workflowName}`,
        body: 'User has no email address on file.',
        kind: 'flagged',
        status: 'skipped',
        refId: input.runId,
      },
    })
  }
  const firstName = await getUserName(userId)
  const count = input.items.length
  const subject =
    count === 1
      ? `1 flagged item in ${input.workflowName}`
      : `${count} flagged items in ${input.workflowName}`
  const lines = [
    `Hi ${firstName},`,
    ``,
    `An agent run flagged ${count === 1 ? 'an item' : `${count} items`} for your review.`,
    ``,
    `  Workflow: ${input.workflowName}`,
    `  Run:      ${input.runId}`,
    ``,
    `Flagged ${count === 1 ? 'item' : 'items'}:`,
  ]
  for (const item of input.items.slice(0, 25)) {
    lines.push(`  • ${item.title}`)
    if (item.detail && item.detail.trim()) {
      lines.push(`      ${item.detail.trim()}`)
    }
  }
  if (input.items.length > 25) {
    lines.push(`  … and ${input.items.length - 25} more`)
  }
  lines.push(
    ``,
    `Open Apical to review each flagged item.`,
    ``,
    `— The Apical team`,
  )
  return await sendEmail({
    userId,
    to,
    subject,
    body: lines.join('\n'),
    kind: 'flagged',
    refId: input.runId,
  })
}

/**
 * Notify a user about the outcome of a scheduled run (success / failed /
 * timeout). Used by the scheduler mini-service after firing a job.
 */
export async function notifySchedule(
  userId: string,
  input: ScheduleNotifyInput,
): Promise<EmailLog> {
  const to = await getUserEmail(userId)
  if (!to) {
    return await db.emailLog.create({
      data: {
        userId,
        toAddress: '(no email on file)',
        subject: `Scheduled run ${input.status}: ${input.workflowName}`,
        body: 'User has no email address on file.',
        kind: 'schedule',
        status: 'skipped',
        refId: input.runId,
      },
    })
  }
  const firstName = await getUserName(userId)
  const verb =
    input.status === 'success'
      ? 'completed successfully'
      : input.status === 'timeout'
        ? 'timed out'
        : 'failed'
  const subject = `Scheduled run ${verb}: ${input.workflowName}`
  const lines = [
    `Hi ${firstName},`,
    ``,
    `A scheduled agent run ${verb}.`,
    ``,
    `  Workflow: ${input.workflowName}`,
    `  Run:      ${input.runId}`,
    `  Status:   ${input.status}`,
  ]
  if (input.summary && input.summary.trim()) {
    lines.push(``, `Summary:`, `  ${input.summary.trim()}`)
  }
  lines.push(``, `— The Apical team`)
  return await sendEmail({
    userId,
    to,
    subject,
    body: lines.join('\n'),
    kind: 'schedule',
    refId: input.runId,
  })
}

// ---------------- Daily brief ----------------

/** Local-midnight timestamp for "today" (used as the brief's start window). */
function startOfTodayUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

/** Small HTML escape helper. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Format a Date as a friendly UTC date label. */
function formatDateLabel(d: Date): string {
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/**
 * Build a daily brief for the user: today's runs, flagged items, upcoming
 * scheduled jobs, overdue gate approvals, and token usage this billing period.
 * Returns both a plain-text body and a simple HTML version (tables + headings).
 *
 * Does NOT send anything — the caller passes the result to sendEmail(), or
 * the GET /api/notifications/brief endpoint returns it as a preview.
 */
export async function renderDailyBrief(userId: string): Promise<DailyBrief> {
  const firstName = await getUserName(userId)
  const startOfToday = startOfTodayUTC()
  const now = new Date()
  const dateLabel = formatDateLabel(now)

  // ---- Today's runs (via workflow.userId, since Run has no userId) ----
  const runs = await db.run.findMany({
    where: {
      startedAt: { gte: startOfToday },
      workflow: { userId },
    },
    take: 50,
    orderBy: { startedAt: 'desc' },
    include: {
      workflow: { select: { name: true } },
    },
  })

  let totalItems = 0
  let totalAutomatic = 0
  let totalFlagged = 0
  let totalAiSaved = 0
  for (const r of runs) {
    totalItems += r.itemsProcessed
    totalAutomatic += r.automaticCount
    totalFlagged += r.flaggedCount
    totalAiSaved += r.aiCallsSaved
  }

  // ---- Flagged items (drill into today's run reports for per-item detail) ----
  const flaggedItems: Array<{ agent: string; title: string; reason: string }> = []
  for (const r of runs) {
    if (r.flaggedCount === 0) continue
    if (!r.reportJson) continue
    let report: { flags?: Array<{ stepId: string; reason: string; item: string }> } | null = null
    try {
      report = JSON.parse(r.reportJson)
    } catch {
      report = null
    }
    const flags = report?.flags || []
    for (const f of flags.slice(0, 3)) {
      flaggedItems.push({
        agent: r.workflow?.name || 'Unknown agent',
        title: f.item || 'an item',
        reason: f.reason || 'flagged for review',
      })
    }
    if (flaggedItems.length >= 12) break
  }

  // ---- Upcoming scheduled jobs (next 24h, active) ----
  // ScheduledJob has no relation to Workflow in the Prisma schema (only the
  // workflowId column), so we fetch workflow names in a follow-up query.
  const upcoming = await db.scheduledJob.findMany({
    where: {
      userId,
      status: 'active',
      nextRunAt: { gte: now, lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) },
    },
    take: 10,
    orderBy: { nextRunAt: 'asc' },
  })
  const upcomingWorkflowIds = Array.from(new Set(upcoming.map((j) => j.workflowId)))
  const upcomingWorkflows = upcomingWorkflowIds.length
    ? await db.workflow.findMany({
        where: { id: { in: upcomingWorkflowIds } },
        select: { id: true, name: true },
      })
    : []
  const upcomingWorkflowName = new Map(upcomingWorkflows.map((w) => [w.id, w.name]))

  // ---- Overdue gate approvals (any run still awaiting_gate) ----
  const overdueGates = await db.run.findMany({
    where: {
      status: 'awaiting_gate',
      workflow: { userId },
    },
    take: 10,
    orderBy: { startedAt: 'asc' },
    include: { workflow: { select: { name: true } } },
  })

  // ---- Token usage this period (Subscription) ----
  const sub = await db.subscription.findUnique({
    where: { userId },
    select: {
      plan: true,
      tokenAllowanceMonthly: true,
      tokenUsedMonthly: true,
      currentPeriodEnd: true,
    },
  })

  // ---------------- Plain-text body ----------------
  const textLines: string[] = []
  textLines.push(`Hi ${firstName},`)
  textLines.push(``)
  textLines.push(`Here's your Apical daily brief for ${dateLabel} (UTC).`)
  textLines.push(``)

  // Today's runs summary.
  textLines.push(`Today's activity`)
  textLines.push(`-----------------`)
  if (runs.length === 0) {
    textLines.push(`No agent runs today yet.`)
  } else {
    textLines.push(
      `${runs.length} run${runs.length === 1 ? '' : 's'} · ${totalItems} item${totalItems === 1 ? '' : 's'} processed · ${totalAutomatic} automatic · ${totalFlagged} flagged · ${totalAiSaved} AI call${totalAiSaved === 1 ? '' : 's'} saved.`,
    )
    for (const r of runs.slice(0, 8)) {
      const time = r.startedAt.toISOString().slice(11, 16) + ' UTC'
      textLines.push(
        `  • ${time}  ${r.workflow?.name || 'Unknown'} — ${r.itemsProcessed} item${r.itemsProcessed === 1 ? '' : 's'}, ${r.flaggedCount} flagged, status ${r.status}`,
      )
    }
    if (runs.length > 8) {
      textLines.push(`  … and ${runs.length - 8} more.`)
    }
  }
  textLines.push(``)

  // Flagged items.
  textLines.push(`Flagged for review`)
  textLines.push(`-------------------`)
  if (flaggedItems.length === 0 && totalFlagged === 0) {
    textLines.push(`Nothing flagged today. Clean run.`)
  } else if (flaggedItems.length === 0) {
    textLines.push(`${totalFlagged} item${totalFlagged === 1 ? '' : 's'} flagged across today's runs — open Apical for details.`)
  } else {
    for (const f of flaggedItems) {
      textLines.push(`  • [${f.agent}] ${f.title} — ${f.reason}`)
    }
  }
  textLines.push(``)

  // Overdue gate approvals.
  textLines.push(`Awaiting your approval`)
  textLines.push(`-----------------------`)
  if (overdueGates.length === 0) {
    textLines.push(`No gates waiting on you.`)
  } else {
    for (const g of overdueGates) {
      textLines.push(`  • ${g.workflow?.name || 'Unknown'} — run ${g.id} (since ${g.startedAt.toISOString().slice(0, 10)})`)
    }
  }
  textLines.push(``)

  // Upcoming scheduled jobs.
  textLines.push(`Upcoming scheduled jobs (next 24h)`)
  textLines.push(`-----------------------------------`)
  if (upcoming.length === 0) {
    textLines.push(`Nothing scheduled in the next 24 hours.`)
  } else {
    for (const j of upcoming) {
      const when = j.nextRunAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'
      textLines.push(`  • ${when}  ${upcomingWorkflowName.get(j.workflowId) || 'Unknown agent'} (${j.scheduleKind}: ${j.schedule})`)
    }
  }
  textLines.push(``)

  // Token usage.
  textLines.push(`Token usage this period`)
  textLines.push(`------------------------`)
  if (!sub) {
    textLines.push(`No subscription on file.`)
  } else {
    const allowance = sub.tokenAllowanceMonthly
    const used = sub.tokenUsedMonthly
    const pct = allowance > 0 ? Math.round((used / allowance) * 100) : 0
    const periodEnd = sub.currentPeriodEnd
      ? sub.currentPeriodEnd.toISOString().slice(0, 10)
      : 'unknown'
    textLines.push(`Plan: ${sub.plan}`)
    if (allowance > 0) {
      textLines.push(`${used.toLocaleString()} / ${allowance.toLocaleString()} tokens (${pct}%) — period ends ${periodEnd}.`)
    } else {
      textLines.push(`${used.toLocaleString()} tokens used this period (unlimited plan) — period ends ${periodEnd}.`)
    }
  }
  textLines.push(``)
  textLines.push(`— The Apical team`)

  const body = textLines.join('\n')

  // ---------------- HTML body ----------------
  const htmlParts: string[] = []
  htmlParts.push(`<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:14px;color:#0f172a;max-width:640px;margin:0 auto;">`)
  htmlParts.push(`<p>Hi ${escapeHtml(firstName)},</p>`)
  htmlParts.push(`<p style="color:#475569;">Here's your Apical daily brief for <strong>${escapeHtml(dateLabel)}</strong> (UTC).</p>`)

  // Today's activity
  htmlParts.push(`<h3 style="margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">Today's activity</h3>`)
  if (runs.length === 0) {
    htmlParts.push(`<p style="color:#64748b;">No agent runs today yet.</p>`)
  } else {
    htmlParts.push(
      `<p><strong>${runs.length}</strong> run${runs.length === 1 ? '' : 's'} · <strong>${totalItems}</strong> item${totalItems === 1 ? '' : 's'} processed · <strong>${totalAutomatic}</strong> automatic · <strong>${totalFlagged}</strong> flagged · <strong>${totalAiSaved}</strong> AI call${totalAiSaved === 1 ? '' : 's'} saved.</p>`,
    )
    htmlParts.push(`<table style="width:100%;border-collapse:collapse;margin-top:8px;font-size:13px;">`)
    htmlParts.push(`<thead><tr style="background:#f1f5f9;text-align:left;">`)
    htmlParts.push(`<th style="padding:6px 8px;border:1px solid #e2e8f0;">Time</th>`)
    htmlParts.push(`<th style="padding:6px 8px;border:1px solid #e2e8f0;">Agent</th>`)
    htmlParts.push(`<th style="padding:6px 8px;border:1px solid #e2e8f0;">Items</th>`)
    htmlParts.push(`<th style="padding:6px 8px;border:1px solid #e2e8f0;">Flagged</th>`)
    htmlParts.push(`<th style="padding:6px 8px;border:1px solid #e2e8f0;">Status</th>`)
    htmlParts.push(`</tr></thead><tbody>`)
    for (const r of runs.slice(0, 8)) {
      const time = r.startedAt.toISOString().slice(11, 16)
      htmlParts.push(`<tr>`)
      htmlParts.push(`<td style="padding:6px 8px;border:1px solid #e2e8f0;">${escapeHtml(time)}</td>`)
      htmlParts.push(`<td style="padding:6px 8px;border:1px solid #e2e8f0;">${escapeHtml(r.workflow?.name || 'Unknown')}</td>`)
      htmlParts.push(`<td style="padding:6px 8px;border:1px solid #e2e8f0;">${r.itemsProcessed}</td>`)
      htmlParts.push(`<td style="padding:6px 8px;border:1px solid #e2e8f0;">${r.flaggedCount}</td>`)
      htmlParts.push(`<td style="padding:6px 8px;border:1px solid #e2e8f0;">${escapeHtml(r.status)}</td>`)
      htmlParts.push(`</tr>`)
    }
    htmlParts.push(`</tbody></table>`)
    if (runs.length > 8) {
      htmlParts.push(`<p style="color:#64748b;font-size:12px;">… and ${runs.length - 8} more.</p>`)
    }
  }

  // Flagged for review
  htmlParts.push(`<h3 style="margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">Flagged for review</h3>`)
  if (flaggedItems.length === 0 && totalFlagged === 0) {
    htmlParts.push(`<p style="color:#16a34a;">Nothing flagged today. Clean run.</p>`)
  } else if (flaggedItems.length === 0) {
    htmlParts.push(`<p>${totalFlagged} item${totalFlagged === 1 ? '' : 's'} flagged across today's runs — open Apical for details.</p>`)
  } else {
    htmlParts.push(`<ul style="padding-left:20px;">`)
    for (const f of flaggedItems) {
      htmlParts.push(
        `<li><strong>[${escapeHtml(f.agent)}]</strong> ${escapeHtml(f.title)} <span style="color:#64748b;">— ${escapeHtml(f.reason)}</span></li>`,
      )
    }
    htmlParts.push(`</ul>`)
  }

  // Awaiting your approval
  htmlParts.push(`<h3 style="margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">Awaiting your approval</h3>`)
  if (overdueGates.length === 0) {
    htmlParts.push(`<p style="color:#64748b;">No gates waiting on you.</p>`)
  } else {
    htmlParts.push(`<ul style="padding-left:20px;">`)
    for (const g of overdueGates) {
      const since = g.startedAt.toISOString().slice(0, 10)
      htmlParts.push(
        `<li><strong>${escapeHtml(g.workflow?.name || 'Unknown')}</strong> — run <code style="background:#f1f5f9;padding:1px 4px;border-radius:3px;">${escapeHtml(g.id)}</code> (since ${escapeHtml(since)})</li>`,
      )
    }
    htmlParts.push(`</ul>`)
  }

  // Upcoming scheduled jobs
  htmlParts.push(`<h3 style="margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">Upcoming scheduled jobs (next 24h)</h3>`)
  if (upcoming.length === 0) {
    htmlParts.push(`<p style="color:#64748b;">Nothing scheduled in the next 24 hours.</p>`)
  } else {
    htmlParts.push(`<ul style="padding-left:20px;">`)
    for (const j of upcoming) {
      const when = j.nextRunAt.toISOString().replace('T', ' ').slice(0, 16)
      htmlParts.push(
        `<li><strong>${escapeHtml(when)} UTC</strong> — ${escapeHtml(upcomingWorkflowName.get(j.workflowId) || 'Unknown agent')} <span style="color:#64748b;">(${escapeHtml(j.scheduleKind)}: ${escapeHtml(j.schedule)})</span></li>`,
      )
    }
    htmlParts.push(`</ul>`)
  }

  // Token usage
  htmlParts.push(`<h3 style="margin-top:24px;border-bottom:1px solid #e2e8f0;padding-bottom:4px;">Token usage this period</h3>`)
  if (!sub) {
    htmlParts.push(`<p style="color:#64748b;">No subscription on file.</p>`)
  } else {
    const allowance = sub.tokenAllowanceMonthly
    const used = sub.tokenUsedMonthly
    const pct = allowance > 0 ? Math.round((used / allowance) * 100) : 0
    const periodEnd = sub.currentPeriodEnd
      ? sub.currentPeriodEnd.toISOString().slice(0, 10)
      : 'unknown'
    htmlParts.push(`<p>Plan: <strong>${escapeHtml(sub.plan)}</strong></p>`)
    if (allowance > 0) {
      htmlParts.push(
        `<p><strong>${used.toLocaleString()}</strong> / ${allowance.toLocaleString()} tokens (${pct}%) — period ends ${escapeHtml(periodEnd)}.</p>`,
      )
      // Simple bar.
      htmlParts.push(
        `<div style="background:#e2e8f0;border-radius:4px;height:8px;width:100%;margin-top:4px;"><div style="background:${pct >= 100 ? '#dc2626' : pct >= 80 ? '#d97706' : '#16a34a'};height:8px;border-radius:4px;width:${Math.min(100, pct)}%;"></div></div>`,
      )
    } else {
      htmlParts.push(
        `<p><strong>${used.toLocaleString()}</strong> tokens used this period (unlimited plan) — period ends ${escapeHtml(periodEnd)}.</p>`,
      )
    }
  }

  htmlParts.push(`<p style="margin-top:24px;color:#64748b;font-size:12px;">— The Apical team</p>`)
  htmlParts.push(`</div>`)

  const html = htmlParts.join('')

  const subject = `Your Apical daily brief — ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })}`

  return { subject, body, html }
}

/** Render + send the daily brief to the user. */
export async function sendDailyBrief(userId: string): Promise<EmailLog> {
  const to = await getUserEmail(userId)
  if (!to) {
    return await db.emailLog.create({
      data: {
        userId,
        toAddress: '(no email on file)',
        subject: 'Your Apical daily brief',
        body: 'User has no email address on file.',
        kind: 'daily_brief',
        status: 'skipped',
      },
    })
  }
  const brief = await renderDailyBrief(userId)
  return await sendEmail({
    userId,
    to,
    subject: brief.subject,
    body: brief.body,
    kind: 'daily_brief',
  })
}
