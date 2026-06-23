// Apical — workflow runtime engine.
//
// `executeRun(runId, workflow, steps)` walks a workflow's steps in order,
// emitting socket events through the relay so the browser can watch the run
// unfold live. Tool steps simulate mechanical work, reason steps call the LLM
// once (with a per-step confidence + flagged/automatic split), and gate steps
// simulate human approval.
//
// The runtime is invoked fire-and-forget from the POST /api/workflows/[id]/run
// route — the HTTP response returns `{ runId }` immediately so the browser can
// subscribe. Everything from here on is best-effort and logged to the server
// console; it must NEVER crash the process.

import ZAI from 'z-ai-web-dev-sdk'
import { db } from './db'
import { broadcastRun } from './relay-client'
import { parseWorkflowJSON, resolveRefs } from './apical-server'
import { getOAuthToken, decryptOAuthToken } from './oauth-helpers'
import type {
  HttpCallSpec,
  RunReport,
  RunReportItem,
  RunStepStatus,
  Workflow,
  WorkflowStep,
} from './types'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Pick a plausible noun for the items in this workflow's report. */
function itemNoun(workflow: Pick<Workflow, 'name' | 'description'>): string {
  const text = `${workflow.name} ${workflow.description}`.toLowerCase()
  if (/(invoice|payment|stripe|quickbooks|billing)/.test(text)) return 'invoices'
  if (/(expense|audit|finance|receipt)/.test(text)) return 'reports'
  if (/(digest|weekly|summary|report)/.test(text)) return 'digests'
  if (/(scan|pdf|document|sorter|sort)/.test(text)) return 'documents'
  return 'items'
}

// Plausible filenames per workflow theme — used for both tool outputs and the
// final report.
function filenamesFor(workflow: Pick<Workflow, 'name' | 'description'>, n: number): string[] {
  const text = `${workflow.name} ${workflow.description}`.toLowerCase()
  const samples: string[] = []
  const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)]
  const num = () => Math.floor(1000 + Math.random() * 9000)
  const num2 = () => String(Math.floor(Math.random() * 999)).padStart(4, '0')

  if (/(scan|pdf|sorter|sort)/.test(text)) {
    const clients = ['Smith_LLP', 'Northwind_Co', 'Contoso', 'Acme', 'Globex']
    const kinds = ['contract', 'invoice', 'memo', 'NDA', 'letter', 'brief']
    for (let i = 0; i < n; i++) {
      samples.push(`${pick(clients)}_${pick(kinds)}_${num()}.pdf`)
    }
  } else if (/(invoice|payment|stripe|billing)/.test(text)) {
    const customers = ['Acme Corp', 'Globex LLC', 'Contoso Ltd', 'Northwind Co', 'Initech']
    for (let i = 0; i < n; i++) {
      samples.push(`INV-2024-${String(num()).slice(-4)} — ${pick(customers)}`)
    }
  } else if (/(expense|audit|receipt)/.test(text)) {
    const vendors = ['travel-airline', 'lunch', 'rideshare', 'software', 'hotel']
    for (let i = 0; i < n; i++) {
      samples.push(`expenses_week_${Math.floor(Math.random() * 52) + 1}_${pick(vendors)}.pdf`)
    }
  } else if (/(digest|weekly|summary)/.test(text)) {
    const clients = ['Acme', 'Globex', 'Contoso', 'Northwind', 'Initech']
    for (let i = 0; i < n; i++) {
      samples.push(`digest_${pick(clients)}_${num2()}.md`)
    }
  } else {
    for (let i = 0; i < n; i++) {
      samples.push(`item_${num2()}.dat`)
    }
  }
  return samples
}

/** Strip ```json fences if the LLM wrapped its answer. */
function stripFences(s: string): string {
  let out = s.trim()
  // Remove leading ```json or ``` and trailing ```.
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  // Sometimes the model adds a leading "Here's the JSON:" — try to slice to the
  // first { and last }.
  const first = out.indexOf('{')
  const last = out.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    out = out.slice(first, last + 1)
  }
  return out
}

interface ExecState {
  outputs: Record<string, unknown>
  itemsProcessed: number
  automaticCount: number
  flaggedCount: number
  aiCallsUsed: number
  aiCallsSaved: number
  flaggedItems: { stepId: string; reason: string; item: string }[]
  reportItems: RunReportItem[]
  filenames: string[]
}

/** Resolve `{{cred:service.field}}` references against the credential vault.
 *  Returns the resolved string (or empty string if the credential is missing).
 *
 *  Resolution order for the secret value:
 *    1. If the matched credential has `oauthAccessToken` set (i.e. it was
 *       connected via the OAuth flow), and the requested field is one of
 *       `token`/`key`/`access_token`/`accessToken`, return that token.
 *       (The runtime injects it as a Bearer header downstream.)
 *    2. Otherwise read the requested field (or `key`/`token`/`apikey`/`secret`)
 *       from the credential's `metaJson`.
 *    3. If neither yields a string, return a `<cred:svc:field>` placeholder so
 *       the request shape is still correct (and the runtime falls back to a
 *       simulated response). */
async function resolveCredRefs(
  value: string,
): Promise<{ resolved: string; hadCred: boolean; service: string | null }> {
  const matches = Array.from(value.matchAll(/\{\{\s*cred:([\w.-]+)(?:\.([\w.-]+))?\s*\}\}/g))
  if (matches.length === 0) {
    return { resolved: value, hadCred: false, service: null }
  }
  let out = value
  let hadCred = false
  let service: string | null = null
  for (const m of matches) {
    const svc = m[1]
    const field = m[2] || 'key'
    service = svc
    let replacement = ''
    try {
      // Prefer an ACTIVE credential whose oauthProvider matches the requested
      // service (e.g. {{cred:google.key}} → the OAuth-connected Gmail row).
      // Fall back to the legacy `service contains svc` lookup so existing
      // pre-OAuth workflows still resolve (e.g. {{cred:stripe.key}}).
      const row = await db.credential.findFirst({
        where: {
          OR: [
            { service: { contains: svc } },
            { oauthProvider: svc.toLowerCase() },
          ],
          status: 'active',
        },
        orderBy: { createdAt: 'desc' },
      }) ?? await db.credential.findFirst({
        // Backward-compat: don't filter by status if no active row matched.
        // (Provisioning credentials still render a placeholder.)
        where: { service: { contains: svc } },
        orderBy: { createdAt: 'desc' },
      })
      if (row) {
        hadCred = true
        // Decrypt the stored OAuth access token (vault-encrypted at rest).
        const oauthAccessToken = decryptOAuthToken(row.oauthAccessToken)
        // 1. OAuth access token takes priority when the field asks for a key/token.
        if (
          oauthAccessToken &&
          ['token', 'key', 'access_token', 'accessToken'].includes(field)
        ) {
          replacement = oauthAccessToken
        } else {
          // 2. Fall back to the metaJson fields.
          let meta: Record<string, unknown> = {}
          try {
            meta = JSON.parse(row.metaJson || '{}')
          } catch {
            meta = {}
          }
          const v =
            (meta[field] as unknown) ??
            (meta.key as unknown) ??
            (meta.token as unknown) ??
            (meta.apikey as unknown) ??
            (meta.secret as unknown)
          if (typeof v === 'string' && v) {
            replacement = v
          } else if (oauthAccessToken) {
            // 3. Last-ditch: if the field wasn't token-like but we have an
            //    OAuth token, surface it anyway (some workflows ask for
            //    {{cred:svc.bearer}} etc.).
            replacement = oauthAccessToken
          }
        }
        if (!replacement) {
          // We have a credential row but no real secret stored — use a
          // placeholder so the request shape is correct (and the runtime
          // can decide to fall back to a simulated response).
          replacement = `<cred:${svc}:${field}>`
        }
      } else {
        // Fallback: try the OAuth-only path (in case the credential is
        // connected but its `service` column doesn't contain the lookup
        // string and the row was filtered out above).
        const oauthToken = await getOAuthToken(svc)
        if (oauthToken) {
          hadCred = true
          replacement = oauthToken
        }
      }
    } catch {
      // ignore — leave replacement empty
    }
    out = out.split(m[0]).join(replacement)
  }
  return { resolved: out, hadCred, service }
}

/** Recursively walk a value, resolving `{{cred:...}}` refs in any string. */
async function resolveCredRefsDeep<T>(value: T): Promise<T> {
  if (typeof value === 'string') {
    const { resolved } = await resolveCredRefs(value)
    return resolved as unknown as T
  }
  if (Array.isArray(value)) {
    return (Promise.all(value.map((v) => resolveCredRefsDeep(v))) as unknown) as Promise<T>
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = await resolveCredRefsDeep(v)
    }
    return out as unknown as T
  }
  return value
}

/** Apply the step.http.auth spec to a headers map. Returns the new headers. */
function applyAuthToHeaders(
  headers: Record<string, string>,
  auth: HttpCallSpec['auth'],
  credSecret: string | null,
): Record<string, string> {
  const out = { ...headers }
  if (!auth || auth.type === 'none') return out
  const token = credSecret || `<auth:${auth.type}>`
  if (auth.type === 'bearer') {
    out['Authorization'] = `Bearer ${token}`
  } else if (auth.type === 'apikey_header') {
    const name = auth.headerName || 'X-Api-Key'
    out[name] = token
  } else if (auth.type === 'basic') {
    // Basic auth header — use placeholder creds if no secret was provided.
    const basic = typeof credSecret === 'string' && credSecret.includes(':')
      ? credSecret
      : `apical:${token}`
    out['Authorization'] = `Basic ${Buffer.from(basic).toString('base64')}`
  }
  return out
}

/** Attempt a real HTTP fetch with a 10s timeout. Returns the parsed JSON /
 *  text body on success, or throws on any failure. */
async function fetchWithTimeout(
  method: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs = 10_000,
): Promise<{ status: number; ok: boolean; data: unknown; headers: Headers }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const init: RequestInit = {
      method,
      headers,
      signal: controller.signal,
    }
    if (body !== undefined && body !== null && method !== 'GET' && method !== 'HEAD') {
      const contentType =
        headers['Content-Type'] ||
        headers['content-type'] ||
        'application/json'
      if (typeof body === 'string') {
        init.body = body
      } else {
        try {
          init.body = JSON.stringify(body)
          if (!headers['Content-Type'] && !headers['content-type']) {
            init.headers = { ...headers, 'Content-Type': contentType }
          }
        } catch {
          init.body = String(body)
        }
      }
    }
    const resp = await fetch(url, init)
    const ct = resp.headers.get('content-type') || ''
    let data: unknown = null
    const text = await resp.text()
    if (ct.includes('application/json')) {
      try {
        data = JSON.parse(text)
      } catch {
        data = text
      }
    } else {
      data = text
    }
    return { status: resp.status, ok: resp.ok, data, headers: resp.headers }
  } finally {
    clearTimeout(timer)
  }
}

/** Run an inline http tool step. Resolves refs, attempts the real request
 *  (10s timeout), and falls back to a simulated plausible response when the
 *  call can't go through (network/CORS/timeout/missing credentials). */
async function runHttpStep(
  runId: string,
  step: WorkflowStep,
  state: ExecState,
): Promise<{ output: unknown; aiTokens: number; aiCostCents: number }> {
  const spec = step.http as HttpCallSpec
  const method = spec.method || 'GET'

  // Resolve {{stepId.field}} refs in url/headers/body against step outputs.
  const urlRaw = resolveRefs(spec.url, state.outputs)
  const url = typeof urlRaw === 'string' ? urlRaw : String(urlRaw ?? '')
  const headersIn =
    (resolveRefs(spec.headers || {}, state.outputs) as Record<string, string>) || {}
  const body = resolveRefs(spec.body, state.outputs)

  // Resolve {{cred:service.field}} refs in url + headers + body.
  const urlResolved = (await resolveCredRefs(url)).resolved
  const headersResolved = await resolveCredRefsDeep(headersIn)
  const bodyResolved = await resolveCredRefsDeep(body)

  // Apply the auth spec (may inject Authorization / X-Api-Key headers).
  const credSecret =
    spec.auth && spec.auth.ref
      ? (await resolveCredRefs(`{{cred:${spec.auth.ref}.key}}`)).resolved
      : null
  const finalHeaders = applyAuthToHeaders(
    headersResolved,
    spec.auth,
    credSecret && !credSecret.startsWith('<') && !credSecret.includes('<cred:')
      ? credSecret
      : null,
  )

  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: `${method} ${urlResolved}`,
  })

  // Try the real request. If it fails for any reason (network/CORS/timeout/
  // non-2xx), fall back to a simulated plausible response so the run still
  // completes.
  let output: Record<string, unknown>
  const hadPlaceholderAuth =
    JSON.stringify(finalHeaders).includes('<auth:') ||
    JSON.stringify(finalHeaders).includes('<cred:')

  // Only attempt real fetches for actual public URLs (http/https).
  const isRealUrl = /^https?:\/\//i.test(urlResolved)

  if (isRealUrl && !hadPlaceholderAuth) {
    try {
      const r = await fetchWithTimeout(method, urlResolved, finalHeaders, bodyResolved)
      output = {
        ok: r.ok,
        status: r.status,
        method,
        url: urlResolved,
        data: r.data,
        ...(spec.description ? { description: spec.description } : {}),
      }
      broadcastRun(runId, 'step:progress', {
        runId,
        stepId: step.id,
        message: `Got ${r.status} ${r.ok ? 'OK' : 'response'} in ${method} ${urlResolved}`,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.warn(`[runtime] http step ${step.id} real fetch failed (${msg}); simulating.`)
      output = simulateHttpOutput(method, urlResolved, bodyResolved, spec.description)
      broadcastRun(runId, 'step:progress', {
        runId,
        stepId: step.id,
        message: `Simulated ${method} (real call failed: ${msg})`,
      })
    }
  } else {
    output = simulateHttpOutput(method, urlResolved, bodyResolved, spec.description)
    broadcastRun(runId, 'step:progress', {
      runId,
      stepId: step.id,
      message: hadPlaceholderAuth
        ? `Simulated ${method} ${urlResolved} (placeholder credentials)`
        : `Simulated ${method} ${urlResolved}`,
    })
  }

  // Plausible per-item count so downstream report looks right.
  if (typeof output.count !== 'number') {
    output.count = state.itemsProcessed
  }

  return { output, aiTokens: 0, aiCostCents: 0 }
}

/** Build a plausible simulated response for an http step. */
function simulateHttpOutput(
  method: string,
  url: string,
  body: unknown,
  description?: string,
): Record<string, unknown> {
  return {
    ok: true,
    simulated: true,
    status: 200,
    method,
    url,
    data: {
      message: 'Simulated response (real API call not attempted).',
      receivedBody: body,
      timestamp: new Date().toISOString(),
    },
    ...(description ? { description } : {}),
  }
}

/** Run a single tool step: simulate mechanical work + realistic output. */
async function runToolStep(
  runId: string,
  step: WorkflowStep,
  state: ExecState,
  order: number,
): Promise<{ output: unknown; aiTokens: number; aiCostCents: number }> {
  // If the step has an inline `http` spec, execute that for real instead of
  // simulating a named tool. Resolves {{stepId.field}} refs against earlier
  // step outputs + {{cred:service.field}} refs against the credential vault.
  if (step.http) {
    return runHttpStep(runId, step, state)
  }

  const tool = step.tool || 'unknown.action'
  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: `Running ${tool}…`,
  })

  // Tool duration depends on what's being done — OCR is slow, list is fast.
  let dur = 600
  if (tool.endsWith('.extract') || tool.endsWith('.classify')) dur = 1500
  else if (tool.endsWith('.move') || tool.endsWith('.write')) dur = 400
  else if (tool.endsWith('.send') || tool.endsWith('.notify') || tool.endsWith('.postMessage')) dur = 700
  else if (tool.endsWith('.list') || tool.endsWith('.listNew') || tool.endsWith('.listInvoices')) dur = 350
  // Resolve {{...}} refs in inputs (purely cosmetic — for log realism).
  const resolvedInputs = resolveRefs(step.inputs || {}, state.outputs)

  const N = state.itemsProcessed
  // Pull "flagged" from the most recent reason/gate step if present.
  const flagged = state.flaggedCount
  let output: Record<string, unknown> = { ok: true, count: N, tool }

  if (step.hardened) {
    // Hardened ex-reason steps: deterministic rule application, no AI cost.
    await sleep(dur)
    output = {
      hardened: true,
      ruleApplied: Math.max(0, N - flagged),
      aiCalled: 0,
      rule: step.rule || '(rule)',
    }
    state.aiCallsSaved += N
    return { output, aiTokens: 0, aiCostCents: 0 }
  }

  await sleep(dur)
  if (tool.endsWith('.list') || tool.endsWith('.listNew') || tool.endsWith('.listInvoices')) {
    output = { files: N, filesList: state.filenames.slice(0, Math.min(N, 8)) }
  } else if (tool === 'ocr.extract' || tool.endsWith('.extract')) {
    output = { extracted: N }
  } else if (tool === 'files.move' || tool.endsWith('.move')) {
    output = { moved: Math.max(0, N - flagged) }
  } else if (tool === 'gmail.send' || tool === 'gmail.draft' || tool.endsWith('.send')) {
    output = { sent: Math.max(0, N - flagged) }
  } else if (tool === 'slack.notify' || tool.endsWith('.notify')) {
    output = { notified: true }
  } else if (tool === 'quickbooks.createExpense' || tool.endsWith('.createExpense')) {
    output = { recorded: Math.max(0, N - flagged) }
  } else if (tool === 'scanner.markProcessed' || tool.endsWith('.markProcessed')) {
    output = { marked: N }
  } else if (tool === 'stripe.listInvoices') {
    output = { invoices: N }
  } else if (tool === 'files.write' || tool.endsWith('.write')) {
    output = { wrote: N }
  } else {
    output = { ok: true, count: N, tool, inputs: resolvedInputs }
  }

  return { output, aiTokens: 0, aiCostCents: 0 }
}

/** Run a single reason step: one LLM call + simulated per-item outcomes. */
async function runReasonStep(
  runId: string,
  step: WorkflowStep,
  state: ExecState,
): Promise<{
  output: unknown
  aiTokens: number
  aiCostCents: number
  flagged: number
  confidence: number
  failed: boolean
}> {
  if (step.hardened) {
    // Should not normally happen — reason steps that get hardened flip to
    // `tool` kind. Guard anyway.
    broadcastRun(runId, 'step:progress', {
      runId,
      stepId: step.id,
      message: 'Applying hardened rule…',
    })
    await sleep(300)
    state.aiCallsSaved += state.itemsProcessed
    return {
      output: { hardened: true, ruleApplied: state.itemsProcessed, aiCalled: 0 },
      aiTokens: 0,
      aiCostCents: 0,
      flagged: 0,
      confidence: 1,
      failed: false,
    }
  }

  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: 'Reading input…',
  })

  const N = state.itemsProcessed
  // Build a representative input snippet for the LLM.
  const sampleFile = state.filenames[0] || 'sample.pdf'
  const sampleText = `Document text sample from ${sampleFile}:\n"${sampleFile.replace(/\.pdf$/, '').replace(/_/g, ' ')} — received via scanner. Contains letterhead, dates, and a short body of text the model should classify."`

  const prompt =
    step.prompt ||
    'Classify this input. Return a JSON object with at least a `confidence` field between 0 and 1.'
  const outputShape = step.outputShape
    ? JSON.stringify(step.outputShape)
    : '{ confidence: number }'

  const systemPrompt =
    'You are Apical\'s reasoning engine. Respond with ONLY valid JSON matching the requested output shape. No prose, no code fences.'
  const userPrompt = `${prompt}\n\nRequested output shape: ${outputShape}\n\n${sampleText}`

  let parsed: Record<string, unknown> | null = null
  let aiTokens = 0
  let aiCostCents = 0
  let confidence = 0.9
  let failed = false

  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content || ''
    aiTokens = Math.min(4000, Math.max(80, Math.ceil(text.length / 4) + 120))
    aiCostCents = Math.max(1, Math.ceil(aiTokens / 1000))
    const cleaned = stripFences(text)
    parsed = JSON.parse(cleaned) as Record<string, unknown>
    if (typeof parsed.confidence === 'number') {
      confidence = Math.max(0, Math.min(1, parsed.confidence))
    } else {
      // Pull a plausible confidence out of common field names, else default high.
      const c = (parsed.confidence ??
        parsed.score ??
        parsed.certainty) as unknown
      confidence = typeof c === 'number' ? Math.max(0, Math.min(1, c)) : 0.9
      parsed.confidence = confidence
    }
  } catch (err) {
    console.error('[runtime] reason LLM call failed:', err)
    failed = true
    // Graceful fallback: assume medium confidence so the run continues.
    confidence = 0.78
    parsed = { confidence, note: 'LLM unavailable; using fallback confidence.', fallback: true }
    aiTokens = 0
    aiCostCents = 0
  }

  // Simulate per-item outcomes from the confidence.
  // Some randomness so demo runs feel alive.
  const noise = (Math.random() - 0.5) * 0.08 // ±4%
  const effConfidence = Math.max(0.05, Math.min(0.99, confidence + noise))
  let flagged = Math.max(0, Math.round(N * (1 - effConfidence)))
  // Add a small chance of 0 flagged and a small chance of extra.
  if (Math.random() < 0.2) flagged = 0
  if (Math.random() < 0.25 && flagged === 0) flagged = Math.min(N, 1 + Math.floor(Math.random() * 2))
  flagged = Math.min(flagged, N)
  const automatic = N - flagged

  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: `Classified ${automatic} automatic, ${flagged} flagged for review…`,
  })

  const output = {
    decided: N,
    automatic,
    flagged,
    confidence,
    sample: parsed,
  }

  return { output, aiTokens, aiCostCents, flagged, confidence, failed }
}

/** Run a single gate step: simulate human approval. */
async function runGateStep(
  runId: string,
  step: WorkflowStep,
  state: ExecState,
): Promise<{ output: unknown }> {
  broadcastRun(runId, 'step:progress', {
    runId,
    stepId: step.id,
    message: 'Waiting for approval…',
  })
  const dur = 800 + Math.floor(Math.random() * 700)
  await sleep(dur)
  // For the demo, auto-approve. The flagged count from the preceding reason
  // step becomes the gate's flagged count.
  const output = { approved: true, flagged: state.flaggedCount, message: step.gateMessage }
  return { output }
}

interface RunRow {
  id: string
  workflowId: string
  status: string
  trigger: string
  startedAt: Date
}

interface WorkflowRow {
  id: string
  name: string
  description: string
  stepsJson: string
}

/**
 * Execute a workflow run to completion, streaming progress via the relay.
 * Robustness rules:
 * - Top-level try/catch — never throws to the caller (fire-and-forget).
 * - Each step wrapped in its own try/catch — one bad step fails the step but
 *   can either continue or fail the run, depending on severity.
 * - The relay client auto-reconnects; broadcast failures are swallowed.
 */
export async function executeRun(
  runId: string,
  workflow: WorkflowRow,
  steps: WorkflowStep[],
  trigger: 'manual' | 'schedule' = 'manual',
): Promise<void> {
  const startedAt = Date.now()
  const state: ExecState = {
    outputs: {},
    itemsProcessed: 8 + Math.floor(Math.random() * 40), // 8..47
    automaticCount: 0,
    flaggedCount: 0,
    aiCallsUsed: 0,
    aiCallsSaved: 0,
    flaggedItems: [],
    reportItems: [],
    filenames: [],
  }
  state.filenames = filenamesFor(workflow, state.itemsProcessed)

  broadcastRun(runId, 'run:started', { runId, workflowId: workflow.id })

  let runFailed = false

  try {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i]
      const order = i
      broadcastRun(runId, 'step:started', {
        runId,
        stepId: step.id,
        kind: step.kind,
        label: step.label,
        order,
      })

      // Mark the RunStep running.
      const startedAtStep = new Date()
      await db.runStep.updateMany({
        where: { runId, stepId: step.id },
        data: { status: 'running', startedAt: startedAtStep },
      })

      let output: unknown = null
      let aiTokens = 0
      let aiCostCents = 0
      let stepStatus: RunStepStatus = 'completed'
      try {
        if (step.kind === 'tool') {
          const r = await runToolStep(runId, step, state, order)
          output = r.output
          aiTokens = r.aiTokens
          aiCostCents = r.aiCostCents
        } else if (step.kind === 'reason') {
          const r = await runReasonStep(runId, step, state)
          output = r.output
          aiTokens = r.aiTokens
          aiCostCents = r.aiCostCents
          state.flaggedCount = r.flagged
          state.aiCallsUsed += r.aiTokens > 0 ? 1 : 0
          if (r.failed) {
            // LLM failed but we kept going with a fallback. Mark as completed
            // but note the degraded mode in the output.
            stepStatus = 'completed'
          }
        } else if (step.kind === 'gate') {
          const r = await runGateStep(runId, step, state)
          output = r.output
          // Don't change flaggedCount — gate inherits it.
        }
        state.outputs[step.id] = output
      } catch (err) {
        console.error(`[runtime] step ${step.id} (${step.kind}) failed:`, err)
        stepStatus = 'failed'
        runFailed = true
        output = { error: err instanceof Error ? err.message : String(err) }
      }

      const finishedAtStep = new Date()
      await db.runStep.updateMany({
        where: { runId, stepId: step.id },
        data: {
          status: stepStatus,
          outputJson: JSON.stringify(output),
          aiTokens,
          aiCostCents,
          finishedAt: finishedAtStep,
        },
      })

      broadcastRun(runId, 'step:completed', {
        runId,
        stepId: step.id,
        kind: step.kind,
        status: stepStatus,
        output,
        aiTokens: aiTokens || undefined,
        aiCostCents: aiCostCents || undefined,
      })

      if (runFailed) {
        // Stop the run on a step failure — surface the rest as skipped.
        break
      }

      // Small pacing pause so the UI shows distinct step events.
      await sleep(150)
    }

    // Aggregate. If we broke early on failure, automatic/flagged reflect
    // whatever the last reason step produced (which may be 0/0).
    const automatic = state.itemsProcessed - state.flaggedCount
    state.automaticCount = Math.max(0, automatic)
    const durationMs = Date.now() - startedAt

    // Build the report.
    const noun = itemNoun(workflow)
    const summary = runFailed
      ? `Ran ${state.itemsProcessed} ${noun} but hit an error partway through. ${state.automaticCount} processed automatically, ${state.flaggedCount} flagged.`
      : `Did ${state.itemsProcessed} ${noun}, ${state.automaticCount} automatic, ${state.flaggedCount} I flagged for you.`

    // Sample items — mix outcomes.
    const sampleSize = Math.min(6, state.itemsProcessed)
    const usedNames = new Set<string>()
    const items: RunReportItem[] = []
    for (let i = 0; i < sampleSize; i++) {
      const name = state.filenames[i] || `item_${i + 1}`
      usedNames.add(name)
      let outcome: RunReportItem['outcome'] = 'automatic'
      // First few are flagged if we have any.
      if (i < state.flaggedCount) outcome = 'flagged'
      else if (i === sampleSize - 1 && steps.some((s) => s.kind === 'gate')) outcome = 'gated'
      const detail =
        outcome === 'flagged'
          ? `Confidence below threshold — awaiting your review.`
          : outcome === 'gated'
            ? `Held at gate — approved.`
            : `Processed automatically.`
      items.push({ name, outcome, detail })
    }

    // Flags — one per flagged item, attributed to the gate or reason step.
    const flagStep =
      steps.find((s) => s.kind === 'gate') ||
      steps.find((s) => s.kind === 'reason')
    const flags: { stepId: string; reason: string; item: string }[] = []
    for (let i = 0; i < state.flaggedCount; i++) {
      const name = state.filenames[i] || `flagged_item_${i + 1}`
      flags.push({
        stepId: flagStep?.id || 'unknown',
        reason:
          flagStep?.kind === 'gate'
            ? (flagStep?.gateMessage || 'Needs human review')
            : 'Confidence below threshold',
        item: name,
      })
    }

    const report: RunReport = { summary, items, flags }

    const finalStatus: RunRow['status'] = runFailed ? 'failed' : 'completed'
    await db.run.update({
      where: { id: runId },
      data: {
        status: finalStatus,
        itemsProcessed: state.itemsProcessed,
        automaticCount: state.automaticCount,
        flaggedCount: state.flaggedCount,
        aiCallsUsed: state.aiCallsUsed,
        aiCallsSaved: state.aiCallsSaved,
        durationMs,
        reportJson: JSON.stringify(report),
        finishedAt: new Date(),
      },
    })

    // Backfill any pending RunSteps' finishedAt.
    await db.runStep.updateMany({
      where: { runId, finishedAt: null },
      data: { finishedAt: new Date(), status: 'skipped' },
    })

    // Update workflow aggregate counters.
    await db.workflow.update({
      where: { id: workflow.id },
      data: {
        runsCount: { increment: 1 },
        itemsProcessed: { increment: state.itemsProcessed },
        automaticCount: { increment: state.automaticCount },
        flaggedCount: { increment: state.flaggedCount },
        aiCallsSaved: { increment: state.aiCallsSaved },
        estCostSavedCents: { increment: state.aiCallsSaved * 10 },
      },
    })

    broadcastRun(runId, 'run:report', {
      runId,
      report,
      stats: {
        itemsProcessed: state.itemsProcessed,
        automaticCount: state.automaticCount,
        flaggedCount: state.flaggedCount,
        aiCallsUsed: state.aiCallsUsed,
        aiCallsSaved: state.aiCallsSaved,
        durationMs,
      },
    })

    broadcastRun(runId, 'run:completed', { runId, status: finalStatus })
  } catch (err) {
    // Catastrophic failure — try to mark the run failed and emit a final event.
    console.error('[runtime] executeRun catastrophic failure:', err)
    try {
      await db.run.update({
        where: { id: runId },
        data: {
          status: 'failed',
          finishedAt: new Date(),
          durationMs: Date.now() - startedAt,
        },
      })
    } catch {
      // ignore
    }
    broadcastRun(runId, 'run:completed', { runId, status: 'failed' })
  }
}

/** Re-export for the route handler to use when loading the workflow. */
export function parseSteps(raw: string): WorkflowStep[] {
  return parseWorkflowJSON(raw).steps
}
