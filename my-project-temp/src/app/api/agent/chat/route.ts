import { NextResponse } from 'next/server'
import { simpleComplete, hasHostedLlmProvider } from '@/lib/platform/llm-gateway'
import { searchWeb } from '@/lib/platform/web-search'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { rateLimitByUser } from '@/lib/rate-limit'
import { loadIntegrations } from '@/lib/mappers'
import {
  EVOCATIVE_NAMES,
  generateAgentName,
  type AgentNameStyle,
} from '@/lib/apical-server'
import type {
  ApiDiscoveryCandidate,
  ChatMessage,
  ClarificationOption,
  ClarificationQuestion,
  Integration,
  IntegrationKind,
  ResearchResult,
  ScriptAnalysis,
  UserProfile,
  WorkflowJSON,
  WorkflowStep,
} from '@/lib/types'

// ---------------- Request / response shapes ----------------

interface ChatBody {
  message?: string
  history?: ChatMessage[]
  /** NEW (v3): agents the user @-mentioned in this message. */
  mentionedAgentIds?: string[] | null
  /** LEGACY (v2): single active agent — still accepted, treated as a mention. */
  activeAgentId?: string | null
  conversationId?: string | null
  workspaceId?: string | null
  /** NEW (v4): an attached script (curl/python/javascript) for the agent to analyze. */
  attachedScript?: string
  /** NEW (v4): language hint for the attached script. */
  attachedScriptLanguage?: 'curl' | 'python' | 'javascript' | 'auto'
  /** Which hosted model to use (registry id like openai:gpt-4o, or legacy default/fast/thinking). */
  model?: string
}

type Intent =
  | 'new_agent'
  | 'edit_existing'
  | 'general'
  | 'needs_clarification'
  | 'needs_api'
  | 'needs_research'

interface WorkflowProposal {
  name: string
  description: string
  title?: string
  steps: WorkflowJSON
}

interface Suggestion {
  title: string
  prompt: string
  reason: string
}

interface AgentResponse {
  reply: string
  trace?: { label: string; detail?: string }[]
  intent: Intent
  workflowProposal?: WorkflowProposal
  switchToAgentId?: string
  editingAgentId?: string
  clarification?: ClarificationQuestion
  apiDiscovery?: ApiDiscoveryCandidate[]
  suggestions?: Suggestion[]
  title?: string
  /** NEW (v4): web research grounding the needs_api discovery. */
  research?: ResearchResult
  /** NEW (v4): analysis of an attached code script. */
  scriptAnalysis?: ScriptAnalysis
}

// ---------------- Helpers ----------------

// `EVOCATIVE_NAMES` is imported from @/lib/apical — single source of truth.
// (Local set used for fast lookup in `isLikelyEvocativeName`.)
const EVOCATIVE_NAME_SET = new Set<string>(EVOCATIVE_NAMES)

function isLikelyEvocativeName(s: string): boolean {
  const n = s.trim()
  if (!n) return false
  // Reject human-y names (Pat, Sam, etc.) and thing-words.
  if (EVOCATIVE_NAME_SET.has(n)) return true
  // Single capitalized word, 3-12 chars, not a thing-word.
  if (!/^[A-Z][a-z]{2,11}$/.test(n)) return false
  if (/(pdf|sorter|scanner|file|invoice|expense|workflow|tool|auto|bot|agent|pdf|doc|email|api)$/i.test(n)) return false
  return true
}

/**
 * Pick a name for a new agent using the user's preferred style.
 * The LLM no longer decides the name — it just suggests one, and we override
 * with `generateAgentName(style, jobDescription, existingNames)`.
 *
 * For evocative style: if the LLM suggested a valid evocative name AND it
 * isn't already in use, we keep it (so the model can pick a fitting name).
 * Otherwise we pick an unused one from the EVOCATIVE_NAMES list.
 *
 * For descriptive style: always derive from the job description (the LLM's
 * suggestion is ignored — the user wants descriptive names).
 */
async function pickAgentName(
  style: AgentNameStyle,
  suggested: unknown,
  jobDescription: string,
  existingNames: string[],
): Promise<string> {
  if (style === 'descriptive') {
    return generateAgentName('descriptive', jobDescription, existingNames)
  }
  // For evocative style, try the LLM to generate a fitting name.
  try {
    const prompt = `Generate a single short, evocative, non-human name for an AI agent that does this job: "${jobDescription}".

Rules:
- 4-6 letters, easy to pronounce, memorable (like Nomi, Vexa, Kiro, Sova, Lumo, Talo)
- NOT a common human name (not John, Sarah, Alex)
- NOT a real word (not Scan, Sort, Mail)
- Just the name, no explanation

Existing names to avoid: ${existingNames.join(', ') || 'none'}

Respond with ONLY the name, nothing else.`

    const nameRaw = await simpleComplete({
      messages: [
        { role: 'system', content: 'You generate short, evocative names for AI agents. Respond with a single word.' },
        { role: 'user', content: prompt },
      ],
    })
    const name = nameRaw.trim().split(/\s+/)[0]
    if (name && name.length >= 2 && name.length <= 8 && /^[a-zA-Z]+$/.test(name)) {
      const taken = existingNames.some((n) => n.toLowerCase() === name.toLowerCase())
      if (!taken) return name.charAt(0).toUpperCase() + name.slice(1)
    }
  } catch {
    // Fall through to fallback.
  }
  // Fallback: prefer the LLM's original suggestion if valid.
  if (typeof suggested === 'string' && suggested.trim()) {
    const first = suggested.trim().split(/\s+/)[0]
    const taken = existingNames.some((n) => n.trim().toLowerCase() === first.toLowerCase())
    if (isLikelyEvocativeName(first) && !taken) return first
  }
  return generateAgentName('evocative', jobDescription, existingNames)
}

// Legacy alias — kept so the fallback path doesn't need to know about styles.
function pickEvocativeName(suggested: unknown): string {
  if (typeof suggested === 'string' && suggested.trim()) {
    const first = suggested.trim().split(/\s+/)[0]
    if (isLikelyEvocativeName(first)) return first
  }
  return EVOCATIVE_NAMES[Math.floor(Math.random() * EVOCATIVE_NAMES.length)]
}

/** Build a compact tool catalog string for the system prompt. */
function buildToolCatalog(integrations: Integration[]): string {
  const lines: string[] = []
  for (const it of integrations) {
    for (const tool of it.tools) {
      lines.push(`- ${tool.id} (${it.name}) — ${tool.description}`)
    }
  }
  return lines.join('\n')
}

/** Render an agent's steps compactly so the model can suggest edits. */
function renderStepsBrief(steps: WorkflowStep[]): string {
  return steps
    .map((s) => {
      const parts = [`  - ${s.id} [${s.kind}] ${s.label}`]
      if (s.tool) parts.push(`      tool: ${s.tool}`)
      if (s.prompt) parts.push(`      prompt: ${s.prompt}`)
      if (s.gateMessage) parts.push(`      gate: ${s.gateMessage}`)
      if (s.allowedTools && s.allowedTools.length)
        parts.push(`      allowedTools: ${s.allowedTools.join(', ')}`)
      if (s.hardened) parts.push(`      (hardened — rule applied, no AI)`)
      return parts.join('\n')
    })
    .join('\n')
}

function parseStepsFromJson(raw: unknown): WorkflowStep[] {
  const arr = Array.isArray(raw) ? raw : (raw as { steps?: unknown } | null)?.steps
  if (!Array.isArray(arr)) return []
  return arr.filter((s): s is Record<string, unknown> => !!s && typeof s === 'object')
}

/** Normalize step list defensively — sequential ids, valid kinds, sane defaults. */
function normalizeProposalSteps(raw: unknown): WorkflowStep[] {
  const arr = parseStepsFromJson(raw)
  const steps: WorkflowStep[] = []
  arr.forEach((s, i) => {
    const kind = s.kind === 'reason' || s.kind === 'gate' ? s.kind : 'tool'
    const id = typeof s.id === 'string' && s.id ? s.id : `s${i + 1}`
    const label =
      typeof s.label === 'string' && s.label
        ? s.label
        : kind === 'reason'
          ? 'Reason'
          : kind === 'gate'
            ? 'Approve'
            : 'Run tool'
    const out: WorkflowStep = { id, kind, label }
    if (kind === 'tool') {
      if (typeof s.tool === 'string') out.tool = s.tool
      if (s.inputs && typeof s.inputs === 'object') {
        out.inputs = s.inputs as Record<string, unknown>
      }
    } else if (kind === 'reason') {
      if (typeof s.prompt === 'string') out.prompt = s.prompt
      if (Array.isArray(s.allowedTools)) {
        out.allowedTools = s.allowedTools.filter(
          (t) => typeof t === 'string',
        ) as string[]
      }
      if (s.outputShape && typeof s.outputShape === 'object') {
        out.outputShape = s.outputShape as Record<string, string>
      }
      if (typeof s.confidenceThreshold === 'number') {
        out.confidenceThreshold = s.confidenceThreshold
      }
    } else if (kind === 'gate') {
      if (typeof s.gateMessage === 'string') out.gateMessage = s.gateMessage
    }
    if (typeof s.note === 'string') out.note = s.note
    steps.push(out)
  })
  return steps.map((s, i) => ({ ...s, id: `s${i + 1}` }))
}

function coerceClarification(raw: unknown): ClarificationQuestion | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const question =
    typeof r.question === 'string' && r.question.trim() ? r.question.trim() : ''
  const optsRaw = Array.isArray(r.options) ? r.options : []
  const options: ClarificationOption[] = optsRaw
    .filter((o): o is Record<string, unknown> => !!o && typeof o === 'object')
    .slice(0, 4)
    .map((o, i) => {
      const key =
        typeof o.key === 'string' && o.key ? o.key : String.fromCharCode(65 + i)
      const label =
        typeof o.label === 'string' && o.label ? o.label : `Option ${i + 1}`
      const description =
        typeof o.description === 'string' ? o.description : undefined
      return { key, label, description }
    })
    .filter((o) => o.label)
  if (!question || options.length < 2) return undefined
  return {
    id: typeof r.id === 'string' && r.id ? r.id : 'clarify',
    question,
    options,
    multiple: r.multiple === true,
  }
}

function coerceApiDiscovery(raw: unknown): ApiDiscoveryCandidate[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: ApiDiscoveryCandidate[] = []
  raw.forEach((c, i) => {
    if (!c || typeof c !== 'object') return
    const r = c as Record<string, unknown>
    const service =
      typeof r.service === 'string' && r.service.trim() ? r.service.trim() : ''
    if (!service) return
    const kind: IntegrationKind =
      r.kind === 'mcp' || r.kind === 'http' || r.kind === 'api'
        ? (r.kind as IntegrationKind)
        : 'api'
    const toolsRaw = Array.isArray(r.tools) ? r.tools : []
    const tools = toolsRaw
      .filter(
        (t): t is Record<string, unknown> => !!t && typeof t === 'object',
      )
      .slice(0, 6)
      .map((t, j) => {
        const id =
          typeof t.id === 'string' && t.id
            ? t.id
            : `${service.toLowerCase().replace(/[^a-z0-9]+/g, '')}.tool${j + 1}`
        const name =
          typeof t.name === 'string' && t.name ? t.name : `Tool ${j + 1}`
        const description =
          typeof t.description === 'string' ? t.description : ''
        return { id, name, description }
      })
    const fieldsRaw = Array.isArray(r.credentialFields) ? r.credentialFields : []
    const credentialFields = fieldsRaw
      .filter(
        (f): f is Record<string, unknown> => !!f && typeof f === 'object',
      )
      .slice(0, 5)
      .map((f, j) => {
        const key =
          typeof f.key === 'string' && f.key ? f.key : `field_${j + 1}`
        const label =
          typeof f.label === 'string' && f.label ? f.label : `Field ${j + 1}`
        const type: 'apikey' | 'oauth' | 'mcp_token' =
          f.type === 'oauth' || f.type === 'mcp_token' || f.type === 'apikey'
            ? (f.type as 'apikey' | 'oauth' | 'mcp_token')
            : 'apikey'
        const placeholder =
          typeof f.placeholder === 'string' ? f.placeholder : undefined
        const required = f.required !== false
        return { key, label, type, placeholder, required }
      })
    if (credentialFields.length === 0) {
      // Default: a single API key field.
      credentialFields.push({
        key: 'api_key',
        label: 'API key',
        type: 'apikey',
        placeholder: 'Paste your API key here',
        required: true,
      })
    }
    out.push({
      id: typeof r.id === 'string' && r.id ? r.id : `cand_${i + 1}`,
      service,
      kind,
      specUrl: typeof r.specUrl === 'string' ? r.specUrl : undefined,
      url: typeof r.url === 'string' ? r.url : undefined,
      description:
        typeof r.description === 'string' && r.description
          ? r.description
          : `Connect ${service} so your agents can use it.`,
      tools,
      credentialFields,
    })
  })
  if (out.length === 0) return undefined
  return out
}

function coerceSuggestions(raw: unknown): Suggestion[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const out: Suggestion[] = []
  raw.forEach((s) => {
    if (!s || typeof s !== 'object') return
    const r = s as Record<string, unknown>
    const title =
      typeof r.title === 'string' && r.title.trim() ? r.title.trim() : ''
    const prompt =
      typeof r.prompt === 'string' && r.prompt.trim() ? r.prompt.trim() : ''
    const reason =
      typeof r.reason === 'string' && r.reason.trim() ? r.reason.trim() : ''
    if (title && prompt) out.push({ title, prompt, reason })
  })
  if (out.length === 0) return undefined
  return out
}

/** Strip code fences + grab the outermost JSON object. */
function stripFences(s: string): string {
  let out = s.trim()
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const first = out.indexOf('{')
  const last = out.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    out = out.slice(first, last + 1)
  }
  return out
}

// ---------------- Web research (for needs_api) ----------------

interface SearchResult {
  url: string
  name: string
  snippet?: string
  host_name?: string
  rank?: number
}

function coerceKind(raw: unknown): IntegrationKind {
  if (raw === 'mcp' || raw === 'http' || raw === 'api') return raw
  return 'api'
}

/** Run a web search + LLM synthesis to ground `needs_api` candidates in real
 *  docs. Returns a ResearchResult. Used inline by the chat route when the
 *  intent is needs_api (so the chat response carries both apiDiscovery +
 *  the sources the discovery was based on). */
async function runResearch(query: string): Promise<ResearchResult> {
  let searchResults: SearchResult[] = []
  try {
    const raw = await searchWeb(`${query} API documentation`, 8)
    searchResults = raw.map((r) => ({
      url: r.url,
      name: r.title || r.url,
      snippet: r.snippet,
      host_name: r.host,
    }))
  } catch (err) {
    console.error('[api/agent/chat] web_search failed:', err)
  }

  const sources = searchResults.slice(0, 8).map((r) => ({
    title: r.name || r.url,
    url: r.url,
    snippet: r.snippet || undefined,
  }))

  let summary =
    sources.length > 0
      ? `I found ${sources.length} source(s) about "${query}".`
      : `I couldn't find web results about "${query}" right now.`
  let candidates: ApiDiscoveryCandidate[] = []

  const systemPrompt = `You are researching APIs for an automation platform. Given these search results about '${query}', identify any APIs or MCP servers found. For each, return: service name, kind (mcp/api/http), the doc URL, a description, 2-4 plausible tools (id + name + description), and what credentials are needed (as credentialFields). Respond with ONLY JSON: { summary, sources: [{title,url,snippet}], candidates: [ApiDiscoveryCandidate] }. If nothing real was found, return empty candidates with an honest summary. The \`candidates\` array shape is: [{ id, service, kind: 'mcp'|'api'|'http', specUrl?, url?, description, tools: [{id,name,description}], credentialFields: [{key,label,type:'apikey'|'oauth'|'mcp_token',placeholder?,required}] }]. Never invent tools for the user's existing connected tools — only for the discovered service. credentialFields should describe what the user must provide to connect.`

  const sourcesBlock = sources.length
    ? sources
        .map(
          (s, i) =>
            `${i + 1}. ${s.title}\n   URL: ${s.url}\n   ${s.snippet ? s.snippet : ''}`.trim(),
        )
        .join('\n')
    : '(No web results.)'

  try {
    const text = await simpleComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Web search results for "${query} API documentation":\n\n${sourcesBlock}\n\nSynthesize a ResearchResult. Reply with ONLY the JSON object.`,
        },
      ],
      json: true,
    })
    const cleaned = stripFences(text)
    const parsed = JSON.parse(cleaned) as {
      summary?: unknown
      candidates?: unknown
    }
    if (typeof parsed.summary === 'string' && parsed.summary.trim()) {
      summary = parsed.summary.trim()
    }
    candidates = coerceApiDiscovery(parsed.candidates) || []
  } catch (err) {
    console.error('[api/agent/chat] research LLM synthesis failed:', err)
  }

  return { query, summary, sources, candidates }
}

// ---------------- Script analysis (for attachedScript) ----------------

function coerceAuthType(
  raw: unknown,
): 'bearer' | 'apikey_header' | 'basic' | 'none' {
  if (raw === 'bearer' || raw === 'apikey_header' || raw === 'basic' || raw === 'none') {
    return raw
  }
  return 'none'
}

/** Coerce the LLM-proposed WorkflowStep (must have an http field). */
function coerceProposedStep(raw: unknown): WorkflowStep | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && r.id ? r.id : 's1'
  const label =
    typeof r.label === 'string' && r.label ? r.label : 'Call API'
  const step: WorkflowStep = { id, kind: 'tool', label }

  if (typeof r.tool === 'string' && r.tool) step.tool = r.tool
  if (r.inputs && typeof r.inputs === 'object') {
    step.inputs = r.inputs as Record<string, unknown>
  }

  if (r.http && typeof r.http === 'object') {
    const h = r.http as Record<string, unknown>
    const method =
      typeof h.method === 'string' &&
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(
        String(h.method).toUpperCase(),
      )
        ? (String(h.method).toUpperCase() as
            | 'GET'
            | 'POST'
            | 'PUT'
            | 'PATCH'
            | 'DELETE')
        : 'GET'
    const url = typeof h.url === 'string' ? h.url : ''
    if (!url) return undefined
    const headers =
      h.headers && typeof h.headers === 'object' && !Array.isArray(h.headers)
        ? Object.fromEntries(
            Object.entries(h.headers as Record<string, unknown>)
              .filter(
                ([, v]) => typeof v === 'string' || typeof v === 'number',
              )
              .map(([k, v]) => [k, String(v)]),
          )
        : undefined
    const body = 'body' in h ? h.body : undefined
    const auth =
      h.auth && typeof h.auth === 'object' && !Array.isArray(h.auth)
        ? (() => {
            const a = h.auth as Record<string, unknown>
            const type = coerceAuthType(a.type)
            const out: {
              type: 'bearer' | 'apikey_header' | 'basic' | 'none'
              ref?: string
              headerName?: string
            } = { type }
            if (typeof a.ref === 'string' && a.ref) out.ref = a.ref
            if (typeof a.headerName === 'string' && a.headerName) {
              out.headerName = a.headerName
            }
            return out
          })()
        : undefined
    const description =
      typeof h.description === 'string' && h.description
        ? h.description
        : undefined
    step.http = {
      method,
      url,
      ...(headers ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(auth ? { auth } : {}),
      ...(description ? { description } : {}),
    }
  }

  if (typeof r.note === 'string' && r.note) step.note = r.note
  return step
}

/** Analyze an attached script and return a ScriptAnalysis. The reply text
 *  should explain what the script does and propose adding it as a step. */
async function runScriptAnalysis(
  script: string,
  language: 'curl' | 'python' | 'javascript' | 'auto',
): Promise<ScriptAnalysis> {
  const truncated =
    script.length > 4000 ? script.slice(0, 4000) + '\n…(truncated)' : script

  const systemPrompt = `You are an API reverse-engineer. Given this script, infer what API it calls. Return ONLY JSON: { language, summary, inferredCalls: [{ method, url, headers?, bodyShape?, authType?, description }], proposedStep: WorkflowStep (a tool step with an http field), proposedIntegration?: { name, kind, description, tools } }. The proposedStep should be a ready-to-use workflow step with a unique id, kind 'tool', a clear label, and an http field built from the inferred call. If the script doesn't call an API, say so in the summary and return empty inferredCalls.

The proposedStep.http shape is:
{ method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', url: string, headers?: Record<string,string>, body?: any, auth?: { type: 'bearer'|'apikey_header'|'basic'|'none', ref?: string, headerName?: string }, description?: string }

For auth:
- bearer: token in Authorization header (set auth.type='bearer', auth.ref='cred_<service>')
- apikey_header: API key in a custom header (set auth.type='apikey_header', auth.headerName='X-Api-Key', auth.ref='cred_<service>')
- basic: HTTP basic auth (auth.type='basic')
- none: no auth (auth.type='none')

For the proposedIntegration, return { name, kind: 'mcp'|'api'|'http', description, tools: [{id,name,description}] } where the tools match what the script demonstrates. Use a descriptive name based on the URL's host or service.`

  try {
    const text = await simpleComplete({
      messages: [
        { role: 'system', content: systemPrompt },
        {
          role: 'user',
          content: `Detected/inferred language hint: ${language}\n\nScript:\n\`\`\`\n${truncated}\n\`\`\`\n\nAnalyze this script and return ONLY the JSON object.`,
        },
      ],
      json: true,
    })
    const cleaned = stripFences(text)
    const parsed = JSON.parse(cleaned) as {
      language?: unknown
      summary?: unknown
      inferredCalls?: unknown
      proposedStep?: unknown
      proposedIntegration?: unknown
    }

    const lang =
      typeof parsed.language === 'string' && parsed.language
        ? parsed.language
        : language === 'auto'
          ? 'unknown'
          : language
    const summary =
      typeof parsed.summary === 'string' && parsed.summary
        ? parsed.summary
        : 'Could not infer what this script does.'

    const inferredCalls = Array.isArray(parsed.inferredCalls)
      ? parsed.inferredCalls
          .filter(
            (c): c is Record<string, unknown> => !!c && typeof c === 'object',
          )
          .map((c) => {
            const method =
              typeof c.method === 'string' ? c.method.toUpperCase() : 'GET'
            const url = typeof c.url === 'string' ? c.url : ''
            const headers =
              c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)
                ? Object.fromEntries(
                    Object.entries(c.headers as Record<string, unknown>)
                      .filter(
                        ([, v]) => typeof v === 'string' || typeof v === 'number',
                      )
                      .map(([k, v]) => [k, String(v)]),
                  )
                : undefined
            const bodyShape =
              typeof c.bodyShape === 'string' ? c.bodyShape : undefined
            const authType = coerceAuthType(c.authType)
            const description =
              typeof c.description === 'string' ? c.description : ''
            return {
              method,
              url,
              ...(headers ? { headers } : {}),
              ...(bodyShape ? { bodyShape } : {}),
              authType,
              description,
            }
          })
      : []

    const proposedStep = coerceProposedStep(parsed.proposedStep)
    const proposedIntegration =
      parsed.proposedIntegration &&
      typeof parsed.proposedIntegration === 'object'
        ? (() => {
            const pi = parsed.proposedIntegration as Record<string, unknown>
            const name =
              typeof pi.name === 'string' && pi.name ? pi.name : ''
            if (!name) return undefined
            const kind = coerceKind(pi.kind)
            const description =
              typeof pi.description === 'string' ? pi.description : ''
            const tools = Array.isArray(pi.tools)
              ? pi.tools
                  .filter(
                    (t): t is Record<string, unknown> =>
                      !!t && typeof t === 'object',
                  )
                  .slice(0, 6)
                  .map((t, j) => ({
                    id:
                      typeof t.id === 'string' && t.id
                        ? t.id
                        : `tool${j + 1}`,
                    name:
                      typeof t.name === 'string' && t.name
                        ? t.name
                        : `Tool ${j + 1}`,
                    description:
                      typeof t.description === 'string' ? t.description : '',
                  }))
              : []
            return { name, kind, description, tools }
          })()
        : undefined

    return {
      language: lang,
      summary,
      inferredCalls,
      ...(proposedStep ? { proposedStep } : {}),
      ...(proposedIntegration ? { proposedIntegration } : {}),
    }
  } catch (err) {
    console.error('[api/agent/chat] script analysis failed:', err)
    return {
      language: language === 'auto' ? 'unknown' : language,
      summary:
        "I tried to analyze the attached script but couldn't reach the reasoning engine. Please try again in a moment.",
      inferredCalls: [],
    }
  }
}

// ---------------- Profile / roster / context builders ----------------

function renderProfile(profile: UserProfile | null): string {
  if (!profile) return '(No company profile on file yet — keep suggestions general.)'
  const parts: string[] = []
  if (profile.companyName) parts.push(`Company: ${profile.companyName}`)
  if (profile.industry) parts.push(`Industry: ${profile.industry}`)
  if (profile.notes) parts.push(`Notes: ${profile.notes}`)
  if (profile.dataSources && profile.dataSources.length) {
    parts.push(
      'Data sources they rely on:',
      ...profile.dataSources.map(
        (d) => `  - ${d.label} (${d.kind}) — ${d.detail}`,
      ),
    )
  }
  return parts.join('\n')
}

function renderRoster(
  agents: Array<{
    id: string
    name: string
    title: string | null
    department: string | null
    description: string
    status: string
    trigger: string
    schedule: string | null
  }>,
): string {
  if (agents.length === 0)
    return '(No agents in this workspace yet — the user has a blank slate.)'
  return agents
    .map((a) => {
      const title = a.title ?? 'Agent'
      return `- ${a.name} (${title}) — ${a.status}, ${a.trigger}${a.schedule ? ` ${a.schedule}` : ''}. id: ${a.id}. Does: ${a.description}`
    })
    .join('\n')
}

/** A mention context entry — full workflow + its most recent run. */
interface MentionedAgentRow {
  id: string
  name: string
  title: string | null
  department: string | null
  description: string
  status: string
  trigger: string
  schedule: string | null
  stepsJson: string
  lastRun: {
    id: string
    status: string
    startedAt: Date
    itemsProcessed: number
    automaticCount: number
    flaggedCount: number
    durationMs: number
    reportSummary: string | null
  } | null
}

function renderActiveAgent(a: {
  id: string
  name: string
  title: string | null
  department: string | null
  description: string
  trigger: string
  schedule: string | null
  stepsJson: string
} | null): string {
  if (!a) return '(No agent is currently selected — the user is talking about the workspace in general.)'
  const steps = parseStepsFromJson(JSON.parse(a.stepsJson || '{"steps":[]}'))
  return [
    `Currently selected agent: ${a.name}${a.title ? ` (${a.title})` : ''}.`,
    `Description: ${a.description}`,
    `Trigger: ${a.trigger}${a.schedule ? ` — ${a.schedule}` : ''}.`,
    `Current steps:`,
    renderStepsBrief(steps),
  ].join('\n')
}

function renderMentionedAgents(agents: MentionedAgentRow[]): string {
  if (agents.length === 0)
    return '(No agents @-mentioned in this message — the user is talking about the workspace in general, or asking to set up something new.)'
  const blocks = agents.map((a, i) => {
    const steps = parseStepsFromJson(JSON.parse(a.stepsJson || '{"steps":[]}'))
    const lines: string[] = []
    lines.push(`${i + 1}. ${a.name}${a.title ? ` (${a.title})` : ''} — id: ${a.id}`)
    lines.push(`   Status: ${a.status}. Trigger: ${a.trigger}${a.schedule ? ` — ${a.schedule}` : ''}.`)
    lines.push(`   Description: ${a.description}`)
    if (a.lastRun) {
      const minsAgo = Math.max(
        1,
        Math.round((Date.now() - a.lastRun.startedAt.getTime()) / 60000),
      )
      const ago = minsAgo < 60 ? `${minsAgo}m ago` : `${Math.round(minsAgo / 60)}h ago`
      lines.push(
        `   Last run (${ago}, status: ${a.lastRun.status}): ${a.lastRun.reportSummary || `Processed ${a.lastRun.itemsProcessed} items.`} — ${a.lastRun.itemsProcessed} items, ${a.lastRun.automaticCount} automatic, ${a.lastRun.flaggedCount} flagged.`,
      )
    } else {
      lines.push(`   Last run: (none yet)`)
    }
    lines.push(`   Current steps:`)
    lines.push(renderStepsBrief(steps).replace(/^/gm, '   '))
    return lines.join('\n')
  })
  return blocks.join('\n\n')
}

// ---------------- System prompt ----------------

const SYSTEM_PROMPT = `You are the Apical Assistant — a knowledgeable, plain-English assistant who helps a user manage their AI AGENTS. ("Agents" — never "employees" or "workflows" when speaking to the user. They are AI assistants that do repetitive office work on a schedule.)

The user is NOT technical. Speak plainly, no jargon.

@MENTION MODEL: the user can @-mention agents in their message (like social-media tagging, e.g. "@Sorter what did you do today?"). Mentioned agents are listed below under MENTIONED AGENTS. A mention means: this message is ABOUT or DIRECTED AT those agents. Multiple mentions = the message involves all of them. If no agents are mentioned, the user is talking about the workspace in general, or asking to set up something new.

Your job: figure out what the user needs and route it to ONE of these intents:

IMPORTANT — METHODICAL AGENT CREATION: When a user describes a new job to automate, DO NOT immediately propose a complete workflow. Instead, follow this process:
1. CONSIDER — think about what the user wants, what tools/data sources are available, and what approach makes sense.
2. RESEARCH — if the task involves external data sources, APIs, or complex logic, use intent "needs_research" to trigger a deep research session that crawls the web, finds data sources, and proposes a grounded plan.
3. PLAN — once you understand the task, propose a plan (in your reply) BEFORE proposing the workflow. Explain what you'd build and why.
4. ASK QUESTIONS — if anything is ambiguous (which folder? which channel? how often? what counts as "flagged"?), use intent "needs_clarification" with specific options. DON'T guess.
5. INTEGRATE — only after the user confirms the plan, propose the actual workflow (intent "new_agent" with workflowProposal).
6. TEST — after the workflow is created, the user can run it. If it fails or produces bad results, they'll tell you, and you iterate (intent "edit_existing").

So the typical flow is: user describes job → you CONSIDER + ask clarifying questions OR trigger research → user confirms → you PROPOSE the workflow → user approves → agent is created → user tests → you iterate.

1. "new_agent" — ONLY use this when you have enough information to propose a well-thought-out workflow. If you're missing details, use needs_clarification first. If the task is complex/research-heavy, use needs_research first. Include a descriptive name, role title, and a tool/reason/gate workflow.
2. "edit_existing" — the user wants to modify an existing agent. Prefer setting \`editingAgentId\` to a MENTIONED agent (if any). If the user seems to mean a different agent than the ones tagged, set \`switchToAgentId\` to that agent's id instead. Describe the change in plain English in \`reply\`.
3. "general" — a question or chat. If the user @-mentioned a specific agent and asked a question about it, scope your answer to that agent. Answer plainly. No proposal.
4. "needs_clarification" — the request is ambiguous (missing a key detail like "which folder?", "which channel?", "how often?", "what should trigger it?"). Return a \`clarification\` question with 2-4 single-choice options. Each option has key, label, and description. Include a clear \`reply\` framing the question. This is PREFERRED over guessing.
5. "needs_api" — the job needs a tool the user doesn't have connected. Return \`apiDiscovery\` candidates with credential fields. Include a \`reply\` explaining what's needed.
6. "needs_research" — the user's request is a complex task that requires reasoning about data sources, tools, APIs, or strategies. This includes research tasks ("find me potential clients"), monitoring tasks ("track competitor pricing"), data-gathering tasks ("scrape job listings"), or any task where the agent needs to figure out WHERE to get data and HOW to process it. The backend will run a deep research session that considers ALL available tools (filesystem, CLI, network, MCP, APIs, web search) and proposes a grounded workflow. Set \`reply\` to explain what you'll research.

ALSO: when the user's message is EMPTY or asks "what should I automate?" / "give me ideas" — return intent "general" AND a \`suggestions\` array of 3-4 tailored prompts based on the user's profile + existing agents + data sources. Each suggestion has title, prompt, and a \`reason\` explaining why it's relevant to THEM. E.g. if they use Stripe + QuickBooks but have no invoice-chase agent, suggest "Chase overdue invoices" with reason "You use Stripe and QuickBooks but have no one chasing late invoices — cash-flow win."

__USER_PROFILE__

MENTIONED AGENTS (the user @-tagged these in THIS message — the message is about / directed at them; multiple tags = the message involves all of them):
__MENTIONED_AGENTS__

EXISTING AGENTS IN THIS WORKSPACE:
__AGENT_ROSTER__

TOOL CATALOG (use these exact tool ids in steps; never invent new ones for new_agent steps):
__TOOL_CATALOG__

A workflow is a JSON list of steps. Each step has a \`kind\`:
- "tool": mechanical, calls one tool (e.g. "files.list"), no AI. Use for listing, reading, moving, sending.
- "reason": judgment. The AI reads input, maybe calls a tool, returns a structured answer. Use ONLY where genuine judgment is needed. Carry prompt, allowedTools (tool ids from the catalog), outputShape (field→type), confidenceThreshold (0-1).
- "gate": pause for human approval before anything irreversible. Carry gateMessage.

Steps pass data: later steps reference earlier outputs as {{stepId.field}}.

NAMING NEW AGENTS: agent names are EVOCATIVE or DESCRIPTIVE, never human. Examples: Sorter, Herald, Ledger, Compass, Beacon, Forge, Atlas, Helm, Relay, Quill, Loom, Sage, Echo, Pilot, Anchor, Curator, Sentinel, Bridge, Lens, Vault, Tally, Index, Ember, Harbor, Meridian, Nexus, Orbit, Spire, Vellum. Pick a fitting name for the job. The user can rename later.

LABELS: every step MUST have a short, descriptive, action-oriented \`label\` like "List new scans", "Extract text", "Classify client", "Approve filing", "Move to client folder". Never generic labels like "Run tool" or "Reason".

Respond with ONLY JSON (no prose, no code fences). Shape:

{
  "trace": [ { "label": "...", "detail": "..." } ],
  "reply": "plain-English answer (length depends on intent — see REPLY LENGTH rule below)",
  "intent": "new_agent" | "edit_existing" | "general" | "needs_clarification" | "needs_api" | "needs_research",
  "title": "short 2-4 word title for this conversation (e.g. 'Scanner sorting', 'Invoice chase', 'Twitter posting') — only set when the user is starting a new topic",
  "workflowProposal": { "name": "Sorter", "description": "...", "title": "Filing Agent", "steps": [ { "id": "s1", "kind": "tool", "label": "...", "tool": "...", "inputs": {...} }, ... ] },
  "switchToAgentId": "<id from roster — use only if the user means a DIFFERENT agent than the ones tagged>",
  "editingAgentId": "<id from roster — prefer a MENTIONED agent when the user is editing>",
  "clarification": { "id": "which_folder", "question": "Which folder should I watch?", "options": [ { "key": "a", "label": "/Scan Inbox", "description": "Where your scanner dumps new PDFs" }, { "key": "b", "label": "/Downloads", "description": "Where you save downloaded PDFs" } ] },
  "apiDiscovery": [ { "id": "cand_1", "service": "X (Twitter)", "kind": "api", "specUrl": "https://developer.x.com/en/docs/api-reference", "description": "Post tweets and read your timeline.", "tools": [ { "id": "x.postTweet", "name": "Post tweet", "description": "Post a new tweet." } ], "credentialFields": [ { "key": "bearer_token", "label": "Bearer token", "type": "apikey", "placeholder": "Your X API bearer token", "required": true } ] } ],
  "suggestions": [ { "title": "Chase overdue invoices", "prompt": "...", "reason": "You use Stripe + QuickBooks but have no one chasing late invoices." } ]
}

Rules:
- For new_agent: pick a fitting EVOCATIVE name and a plain role title ("Filing Agent", "Digest Writer", "Bookkeeper", "Collections Agent", "Inbox Triager"). Mentions are NOT required — the user is describing a new job.
- step ids s1, s2...; at least one tool step; a reason step only where genuine judgment is needed; a gate before irreversible actions when the user wants oversight; 4-8 steps; reference prior outputs with {{s1.files}} etc.
- For edit_existing: include a clear \`reply\` describing the proposed change. Prefer setting \`editingAgentId\` to a MENTIONED agent. If the user means a DIFFERENT agent than the ones tagged (e.g. they say "the bookkeeper" but tagged Sorter), set \`switchToAgentId\` to that agent's id instead. If exactly one agent is mentioned and the user is editing it, that's the editingAgentId.
- For needs_clarification: return the clarification question + a reply that frames it. Don't propose a workflow yet.
- For needs_api: return apiDiscovery candidates + a reply explaining what's missing. Don't propose a workflow yet — wait for the user to provide credentials.
- For general: answer substantively in \`reply\` (2-6 sentences). If a specific agent is @-mentioned, draw on that agent's last run + current steps + status to answer concretely (e.g. "what did you do today?" → summarize the last run: "Sorter filed 47 documents, 44 automatic, 3 flagged."). If the user can take an action, name it. No workflowProposal.
- TRACE: include a \`trace\` array ONLY if you actually looked at something specific (an agent's last run, the user's profile, a tool catalog entry, a roster). Each entry must have a concrete \`label\` (e.g. "Checked Sorter's last run") and a \`detail\` (e.g. "9:00 AM today, 47 items"). If you didn't look at anything (a general question like "what's 2+2?"), return an EMPTY trace array. NEVER invent generic trace items like "Looked around" or "Read your profile" if you didn't.
- REPLY LENGTH: \`reply\` should be long enough to actually answer the question. 1-2 sentences only for clarifications. 3-6 sentences for general questions. 2-4 sentences for new_agent/edit_existing describing what you'll build and why. Never give a one-line non-answer to a substantive question.
- Never invent tool ids in workflowProposal.steps — use only ids from the TOOL CATALOG. (In apiDiscovery.candidates.tools, you MAY invent plausible tool ids for the NEW service being discovered.)
- If the user's message is empty or asks for ideas, include \`suggestions\` (3-4 items) and set intent to "general".

EXAMPLE — new_agent (user: "sort my scanner PDFs"):
{
  "trace": [
    { "label": "Looked around", "detail": "Checked the workspace for the scanner + filing tools." },
    { "label": "Found the right tools", "detail": "scanner.listNew, ocr.extract, files.move are all available." },
    { "label": "Drafted an agent", "detail": "A Filing agent to watch the inbox and file each scan." }
  ],
  "reply": "I'll set up an agent named Sorter to watch your scanner inbox, OCR each PDF, figure out which client it belongs to, and file it — and pause to ask you if anything's unclear.",
  "intent": "new_agent",
  "title": "Scanner sorting",
  "workflowProposal": {
    "name": "Sorter",
    "description": "Watches the scanner inbox, figures out which client each PDF belongs to, and files it. Asks before moving anything uncertain.",
    "title": "Filing Agent",
    "steps": [
      { "id": "s1", "kind": "tool", "label": "List new scans", "tool": "scanner.listNew", "inputs": { "folder": "/Scan Inbox" } },
      { "id": "s2", "kind": "tool", "label": "Extract text", "tool": "ocr.extract", "inputs": { "file": "{{s1.files[]}}" } },
      { "id": "s3", "kind": "reason", "label": "Classify client", "prompt": "Given the extracted text of a scanned document, determine which client it belongs to.", "allowedTools": ["ocr.classify"], "outputShape": { "client": "string", "documentType": "string", "confidence": "number" }, "confidenceThreshold": 0.8 },
      { "id": "s4", "kind": "gate", "label": "Confirm low-confidence", "gateMessage": "Not sure which client — please confirm before filing." },
      { "id": "s5", "kind": "tool", "label": "File in client folder", "tool": "files.move", "inputs": { "file": "{{s1.files[]}}", "dest": "/Clients/{{s3.client}}/" } },
      { "id": "s6", "kind": "tool", "label": "Mark processed", "tool": "scanner.markProcessed", "inputs": { "file": "{{s1.files[]}}" } }
    ]
  }
}

EXAMPLE — general, @-mentioned agent (user: "@Sorter what did you do today?"):
{
  "trace": [
    { "label": "Checked Sorter's last run", "detail": "9:00 AM today, 47 items processed" }
  ],
  "reply": "I ran at 9:00 AM this morning and processed 47 scans from /Scan Inbox. 44 were filed automatically — 23 to /Clients/Acme, 16 to /Clients/Globex, and 5 to /Clients/Initech. 3 were flagged for your review because the OCR confidence was below 0.8 on a handwritten header — you can approve or reassign them in the Runs tab. Next run is scheduled for tomorrow at 9:00 AM.",
  "intent": "general"
}

EXAMPLE — general, simple question (user: "what's the difference between a tool step and a reason step?"):
{
  "trace": [],
  "reply": "A tool step is mechanical — it calls one specific tool (like files.list or gmail.send) with fixed inputs and never uses AI. It's instant and basically free. A reason step uses the AI to make a judgment: it reads input, maybe calls a tool or two, and returns a structured answer. Use tool steps for everything you can predict in advance, and reason steps only where genuine judgment is needed (classifying a document, drafting an email, deciding if something is suspicious). Most agents are mostly tool steps with one or two reason steps at the hard parts.",
  "intent": "general"
}

EXAMPLE — general, vague (user: "help"):
{
  "trace": [],
  "reply": "Happy to help. I can set up a new agent to automate a repetitive job, tweak one you already have, or just answer questions about how Apical works. What would you like to do?",
  "intent": "general",
  "suggestions": [
    { "title": "Sort my scanner PDFs", "prompt": "Sort the PDFs my scanner dumps into /Scan Inbox by client, and file them.", "reason": "A classic first agent — saves an hour a week." },
    { "title": "Chase overdue invoices", "prompt": "Check unpaid invoices every day and send a polite reminder if 7 days late.", "reason": "Automating the chase is a quick cash-flow win." },
    { "title": "Weekly client updates", "prompt": "Every Monday, draft a short summary email to each client about last week.", "reason": "Recurring client comms are perfect for an agent." }
  ]
}


EXAMPLE — needs_clarification (user: "help me with my stuff"):
{
  "trace": [
    { "label": "Looked around", "detail": "You have several agents already — Sorter, Herald, Ledger, Compass." },
    { "label": "Not sure what you mean", "detail": "Could be tweaking an existing agent or starting something new." }
  ],
  "reply": "Happy to help — what would you like to work on? Pick one and we'll go from there.",
  "intent": "needs_clarification",
  "clarification": {
    "id": "what_kind",
    "question": "What would you like to do?",
    "options": [
      { "key": "new", "label": "Set up a new agent", "description": "Automate a job that isn't handled yet" },
      { "key": "edit", "label": "Tweak an existing agent", "description": "Change what Sorter, Herald, Ledger, or Compass does" },
      { "key": "ideas", "label": "Suggest something", "description": "I'll look at your setup and propose a few ideas" },
      { "key": "question", "label": "Just ask a question", "description": "About Apical, your agents, or how something works" }
    ]
  }
}

EXAMPLE — needs_api (user: "post our new invoices to our company Twitter"):
{
  "trace": [
    { "label": "Looked around", "detail": "You don't have a Twitter/X integration connected." },
    { "label": "Researched the API", "detail": "Found the X API v2 — needs a bearer token to post." }
  ],
  "reply": "I can have an agent post new invoices to your company Twitter, but you'll need to connect the X (Twitter) API first. I found it — once you add a bearer token I'll wire up the agent.",
  "intent": "needs_api",
  "apiDiscovery": [
    {
      "id": "cand_1",
      "service": "X (Twitter)",
      "kind": "api",
      "specUrl": "https://developer.x.com/en/docs/twitter-api",
      "description": "Post tweets, read timelines, and manage your company's X presence.",
      "tools": [
        { "id": "x.postTweet", "name": "Post tweet", "description": "Post a new tweet to the authenticated account." },
        { "id": "x.getMe", "name": "Get account", "description": "Fetch the authenticated account's profile." }
      ],
      "credentialFields": [
        { "key": "bearer_token", "label": "Bearer token", "type": "apikey", "placeholder": "Your X API bearer token", "required": true }
      ]
    }
  ]
}`

// ---------------- Canned fallback ----------------

function fallbackResponse(
  message: string,
  ctx: {
    mentionIds?: string[]
    agents?: Array<{
      id: string
      name: string
      title: string | null
      department: string | null
      description: string
    }>
    /** When true, no hosted LLM key is configured — avoid "LLM failed" wording. */
    noLlm?: boolean
  },
): AgentResponse {
  const lower = (message || '').toLowerCase().trim()
  const isEmpty = lower.length === 0
  const agents = ctx.agents ?? []

  const defaultSuggestions = [
    { title: 'Sort my scanner PDFs', prompt: 'Sort the PDFs my scanner dumps into /Scan Inbox by client, and file them.', reason: 'A classic first agent — saves an hour a week.' },
    { title: 'Chase overdue invoices', prompt: 'Check unpaid invoices every day. Send a polite reminder if 7 days late; if 30 days, draft an escalation for me to approve.', reason: 'Automating the chase is a quick cash-flow win.' },
    { title: 'Weekly client updates', prompt: 'Every Monday, draft a short summary email to each client about last week.', reason: 'Recurring client comms are perfect for an agent.' },
  ]

  // ---------- Vague / empty / greeting → general + suggestions ----------
  if (isEmpty || /^(hi|hello|hey|help|sup|yo|test|ok|okay)\b/.test(lower) || lower.length < 6) {
    return {
      reply: isEmpty
        ? "Hi — I'm your Apical Assistant. Tell me what you'd like to automate, or pick one of these to get started:"
        : "Happy to help. I can set up a new agent to automate a repetitive job, tweak one you already have, or just answer questions about how Apical works. What would you like to do?",
      trace: [],
      intent: 'general',
      suggestions: defaultSuggestions,
    }
  }

  // ---------- Concrete automation keywords (before question heuristics) ----------
  const concreteTrace: { label: string; detail?: string }[] = [
    { label: 'Checked the tool catalog', detail: 'Found the tools needed for this job.' },
    { label: 'Drafted a starter workflow', detail: 'A starting point — you can tweak before approving.' },
  ]

  if (/(scan|pdf|sort|file)/.test(lower)) {
    return {
      reply:
        "I'll set up an agent named Sorter to watch your scanner inbox, read each PDF, figure out which client it belongs to, and file it under the right folder — and pause to ask you if anything's unclear.",
      trace: concreteTrace,
      intent: 'new_agent',
      title: 'Scanner sorting',
      workflowProposal: {
        name: 'Sorter',
        description: 'Files incoming scans into the right client folder.',
        title: 'Filing Agent',
        steps: {
          version: 1,
          steps: [
            { id: 's1', kind: 'tool', label: 'List new scans', tool: 'scanner.listNew', inputs: { folder: '/Scan Inbox' }, note: 'Polls for unprocessed scans.' },
            { id: 's2', kind: 'tool', label: 'Extract text', tool: 'ocr.extract', inputs: { file: '{{s1.files[]}}' } },
            { id: 's3', kind: 'reason', label: 'Classify client', prompt: 'Given the extracted text of a scanned document, determine which client it belongs to.', allowedTools: ['ocr.classify'], outputShape: { client: 'string', documentType: 'string', confidence: 'number' }, confidenceThreshold: 0.8 },
            { id: 's4', kind: 'gate', label: 'Confirm low-confidence', gateMessage: 'Confidence below 0.8 — approve filing or reassign.' },
            { id: 's5', kind: 'tool', label: 'Move to client folder', tool: 'files.move', inputs: { file: '{{s1.files[]}}', dest: '/Clients/{{s3.client}}/' } },
            { id: 's6', kind: 'tool', label: 'Mark processed', tool: 'scanner.markProcessed', inputs: { file: '{{s1.files[]}}' } },
          ],
        },
      },
    }
  }

  if (/(invoice|payment|stripe|billing|chase|overdue)/.test(lower)) {
    return {
      reply:
        "I'll set up an agent named Compass to check unpaid invoices every day, draft a polite reminder for anything 7+ days overdue, and gate any 30+ day escalations on your approval before they go out.",
      trace: concreteTrace,
      intent: 'new_agent',
      title: 'Invoice chase',
      workflowProposal: {
        name: 'Compass',
        description: 'Sends reminders for overdue invoices; gates escalations on your approval.',
        title: 'Collections Agent',
        steps: {
          version: 1,
          steps: [
            { id: 's1', kind: 'tool', label: 'List unpaid invoices', tool: 'stripe.listInvoices', inputs: { status: 'open' } },
            { id: 's2', kind: 'reason', label: 'Draft reminder tone', prompt: 'Given an overdue invoice and days past due, draft a reminder email. Polite for 7-29 days; firmer for 30+.', allowedTools: [], outputShape: { subject: 'string', body: 'string' }, confidenceThreshold: 0.7 },
            { id: 's3', kind: 'gate', label: 'Approve escalations', gateMessage: 'Invoices 30+ days overdue need your sign-off.' },
            { id: 's4', kind: 'tool', label: 'Send reminder', tool: 'gmail.send', inputs: { to: '{{s1.invoices[].customerEmail}}', subject: '{{s2.subject}}', body: '{{s2.body}}' } },
          ],
        },
      },
    }
  }

  // ---------- Editing an existing agent via @mention ----------
  if (ctx.mentionIds && ctx.mentionIds.length > 0) {
    return {
      reply:
        "Sounds good — I can help tweak that agent. Tell me a bit more about what you'd like to change (the schedule, a step, the trigger, the threshold for flagging) and I'll write it up.",
      trace: [{ label: 'Pulled up the mentioned agent', detail: 'Ready to edit on your say-so.' }],
      intent: 'edit_existing',
      editingAgentId: ctx.mentionIds[0],
    }
  }

  // ---------- Agent roster questions ----------
  if (
    /(what|which|list|show|tell me about|my)\s+(agent|agents)\b/.test(lower)
    || /\bwho (are|is) (my |your )?agents?\b/.test(lower)
  ) {
    if (agents.length > 0) {
      const list = agents
        .map(
          (a) =>
            `• **${a.name}** (${a.title ?? 'Agent'}): ${a.description}`,
        )
        .join('\n')
      return {
        reply: `You have ${agents.length} agent${agents.length === 1 ? '' : 's'}:\n\n${list}\n\nPick one in the sidebar to chat with it directly, or tell me what new job you'd like automated.`,
        trace: [{ label: 'Listed your agents', detail: 'Pulled from your workspace roster.' }],
        intent: 'general',
      }
    }
    return {
      reply:
        "You don't have any agents yet. Tell me a repetitive job you'd like handled — sorting files, chasing invoices, weekly reports — and I'll draft one for you.",
      trace: [],
      intent: 'general',
      suggestions: defaultSuggestions,
    }
  }

  // ---------- Apical explainer questions ----------
  if (
    /\bhow (does|do) apical\b/.test(lower)
    || /\bwhat('s| is) apical\b/.test(lower)
    || /\bhow (do|does) (agents?|this) work\b/.test(lower)
  ) {
    return {
      reply:
        'Apical hires AI agents to do repetitive work for you. Each agent has a workflow — tool steps (do something), reason steps (think about it), and gate steps (pause for your approval). You chat here to create or tweak agents, then they run on a schedule or on demand. Pick an agent in the sidebar to see its workflow, or describe a job and I\'ll draft a new agent.',
      trace: [{ label: 'Explained Apical', detail: 'General product overview.' }],
      intent: 'general',
    }
  }

  // ---------- Questions (not requests like "can you …") ----------
  const isRequest =
    /^(can you|could you|would you|please|help me|i want|i need|i'd like|let's|lets|make me|create|set up|build|automate)\b/.test(
      lower,
    )
  const isQuestion =
    !isRequest
    && (lower.endsWith('?')
      || /^(how|what|why|when|where|who|which|is|are|do|does|did|will)\b/.test(lower)
      || /\bwhat's\b|\bhow do\b|\bhow does\b|\bwhat is\b|\bwhat are\b/.test(lower))

  if (isQuestion) {
    if (ctx.noLlm) {
      return {
        reply:
          `I'm running in offline demo mode (no LLM API key configured), so I can't answer open-ended questions yet. I can still help you create agents — try describing a job like "sort my scanner PDFs by client" or pick a suggestion below. Add OPENAI_API_KEY to .env.local for full AI replies.`,
        trace: [],
        intent: 'general',
        suggestions: defaultSuggestions,
      }
    }
    return {
      reply: `That's a good question. I tripped up trying to answer it just now — could you rephrase, or give me a bit more context? If you're asking about a specific agent, @-mention it and I'll pull up its details.`,
      trace: [],
      intent: 'general',
    }
  }

  // ---------- Default: ask for clarification, don't auto-propose ----------
  return {
    reply:
      `I want to make sure I build the right thing. Could you tell me a bit more about "${message.slice(0, 120)}" — what triggers it, what should happen, and (if it matters) when it should ask you first? Once I have those details I'll draft an agent for you.`,
    trace: [],
    intent: 'needs_clarification',
    clarification: {
      id: 'more_detail',
      question: 'What would you like this agent to do?',
      options: [
        { key: 'automate', label: 'Automate a repetitive task', description: 'e.g. sorting files, sending reminders, monitoring a feed' },
        { key: 'monitor', label: 'Monitor something and alert me', description: 'e.g. watch a folder, an inbox, a website for changes' },
        { key: 'report', label: 'Generate a recurring report', description: 'e.g. weekly summary, daily digest, monthly totals' },
        { key: 'other', label: 'Something else', description: 'I\'ll describe it in my own words' },
      ],
    },
  }
}

// ---------------- Route handler ----------------

// POST /api/agent/chat — the Apical Assistant. Plain-English assistant with
// context on ALL the user's agents, conversations, data sources, and profile.
// Routes the request to one of five intents: new_agent, edit_existing, general,
// needs_clarification, needs_api. Can also return tailored suggestions for the
// empty state.
export async function POST(req: Request) {
  try {
    // Rate-limit per user (or IP for anonymous traffic). 20 req/min keeps a
    // single caller from hammering the LLM gateway.
    const user = await getCurrentUser(req)
    const rl = rateLimitByUser(user?.id, req, 20, 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { error: 'rate_limited', retryAfter: rl.retryAfter },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
      )
    }
    const body = (await req.json()) as ChatBody
    const message = (body.message || '').trim()
    const workspaceId = body.workspaceId ?? null
    const attachedScript =
      typeof body.attachedScript === 'string' && body.attachedScript.trim()
        ? body.attachedScript.trim()
        : null
    const attachedScriptLanguage =
      body.attachedScriptLanguage === 'curl' ||
      body.attachedScriptLanguage === 'python' ||
      body.attachedScriptLanguage === 'javascript'
        ? body.attachedScriptLanguage
        : 'auto'
    const model =
      typeof body.model === 'string' ? body.model : 'default'

    // If the user attached a script, analyze it inline and return early — we
    // don't need to invoke the main intent-routing LLM at all.
    if (attachedScript) {
      try {
        const analysis = await runScriptAnalysis(
          attachedScript,
          attachedScriptLanguage,
        )
        const reply =
          analysis.inferredCalls.length > 0
            ? `I read your ${analysis.language} script — it ${analysis.summary}${
                analysis.proposedStep
                  ? `. I've drafted a workflow step that makes the same call; review it on the right and add it to an agent when you're ready.`
                  : '.'
              }`
            : `I read your ${analysis.language} script but couldn't identify an API call in it. ${analysis.summary}`
        return NextResponse.json({
          reply,
          trace: [
            {
              label: 'Read the script',
              detail: `Parsed the attached ${analysis.language} script.`,
            },
            ...(analysis.inferredCalls.length > 0
              ? [
                  {
                    label: 'Inferred the API call',
                    detail: `${analysis.inferredCalls[0].method} ${analysis.inferredCalls[0].url}`,
                  },
                ]
              : []),
            ...(analysis.proposedStep
              ? [
                  {
                    label: 'Drafted a workflow step',
                    detail: `Step "${analysis.proposedStep.label}" with an inline http call.`,
                  },
                ]
              : []),
          ],
          intent: 'general',
          scriptAnalysis: analysis,
        } satisfies AgentResponse)
      } catch (err) {
        console.error('[api/agent/chat] attachedScript analysis failed:', err)
        // Fall through to the normal flow.
      }
    }

    // @mention model: merge mentionedAgentIds with the legacy activeAgentId
    // (treat the legacy field as if it were a mention) so nothing breaks
    // during the transition. De-dup, preserve order.
    const mentionedAgentIds = Array.isArray(body.mentionedAgentIds)
      ? body.mentionedAgentIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
      : []
    const legacyActiveId =
      typeof body.activeAgentId === 'string' && body.activeAgentId
        ? body.activeAgentId
        : null
    const mentionIds: string[] = Array.from(
      new Set([...mentionedAgentIds, ...(legacyActiveId ? [legacyActiveId] : [])]),
    )

    // Empty message → return tailored suggestions (general intent, no proposal).
    // We still load context so suggestions can be personalized.
    const isEmpty = message.length === 0

    // Load context in parallel.
    const [profileRow, integrations, agents, mentionedRows, mentionedRuns] = await Promise.all([
      db.userProfile.findFirst(),
      loadIntegrations(),
      db.workflow.findMany({
        where: workspaceId
          ? { OR: [{ workspaceId }, { workspaceId: null }] }
          : undefined,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          title: true,
          department: true,
          description: true,
          status: true,
          trigger: true,
          schedule: true,
          stepsJson: true,
        },
      }),
      // Full rows for the mentioned agents (so we can render their steps).
      mentionIds.length > 0
        ? db.workflow.findMany({
            where: { id: { in: mentionIds } },
          })
        : Promise.resolve([]),
      // Latest run per mentioned agent (one query, group client-side).
      mentionIds.length > 0
        ? db.run.findMany({
            where: { workflowId: { in: mentionIds } },
            orderBy: { startedAt: 'desc' },
            take: 50, // plenty; we'll pick the latest per workflow below
            select: {
              id: true,
              workflowId: true,
              status: true,
              startedAt: true,
              itemsProcessed: true,
              automaticCount: true,
              flaggedCount: true,
              durationMs: true,
              reportJson: true,
            },
          })
        : Promise.resolve([]),
    ])

    // Build the mentioned-agent rows (preserve mention order; attach latest run).
    const latestRunByWorkflow = new Map<string, (typeof mentionedRuns)[number]>()
    for (const r of mentionedRuns) {
      if (!latestRunByWorkflow.has(r.workflowId)) {
        latestRunByWorkflow.set(r.workflowId, r)
      }
    }
    const mentionedAgentRows: MentionedAgentRow[] = mentionIds
      .map((id) => mentionedRows.find((w) => w.id === id))
      .filter((w): w is NonNullable<typeof w> => !!w)
      .map((w) => {
        const last = latestRunByWorkflow.get(w.id) || null
        let reportSummary: string | null = null
        if (last?.reportJson) {
          try {
            const p = JSON.parse(last.reportJson) as { summary?: unknown }
            if (typeof p?.summary === 'string') reportSummary = p.summary
          } catch {
            reportSummary = null
          }
        }
        return {
          id: w.id,
          name: w.name,
          title: w.title,
          department: w.department,
          description: w.description,
          status: w.status,
          trigger: w.trigger,
          schedule: w.schedule,
          stepsJson: w.stepsJson,
          lastRun: last
            ? {
                id: last.id,
                status: last.status,
                startedAt: last.startedAt,
                itemsProcessed: last.itemsProcessed,
                automaticCount: last.automaticCount,
                flaggedCount: last.flaggedCount,
                durationMs: last.durationMs,
                reportSummary,
              }
            : null,
        }
      })

    // Map the profile row to the UserProfile shape.
    let profile: UserProfile | null = null
    if (profileRow) {
      let dataSources: UserProfile['dataSources'] = []
      try {
        const parsed = JSON.parse(profileRow.dataSourcesJson || '[]')
        if (Array.isArray(parsed)) {
          dataSources = parsed
            .filter(
              (d): d is { label: string; kind: string; detail: string } =>
                !!d && typeof d === 'object' && typeof (d as { label?: unknown }).label === 'string',
            )
            .map((d) => ({
              label: d.label,
              kind: d.kind || 'other',
              detail: d.detail || '',
            }))
        }
      } catch {
        dataSources = []
      }
      profile = {
        id: profileRow.id,
        companyName: profileRow.companyName,
        industry: profileRow.industry,
        notes: profileRow.notes,
        dataSources,
        createdAt: profileRow.createdAt.toISOString(),
        updatedAt: profileRow.updatedAt.toISOString(),
      }
    }

    const toolCatalog = buildToolCatalog(integrations)
    const roster = renderRoster(agents)
    const mentionedBlock = renderMentionedAgents(mentionedAgentRows)
    const profileBlock = renderProfile(profile)

    const systemPrompt = SYSTEM_PROMPT.replace(
      '__USER_PROFILE__',
      `USER PROFILE:\n${profileBlock}`,
    )
      .replace('__MENTIONED_AGENTS__', mentionedBlock)
      .replace('__AGENT_ROSTER__', roster)
      .replace('__TOOL_CATALOG__', toolCatalog || '(no tools connected yet)')

    // For empty messages, prompt the LLM to return suggestions.
    const userMessage = isEmpty
      ? `The user just opened the chat. Look at their profile, existing agents, and data sources, and suggest 3-4 tailored automation ideas. Return intent "general" with a short \`reply\` (one sentence, friendly) and a \`suggestions\` array of 3-4 items, each with title + prompt + reason. Pick ideas that FILL GAPS — things they don't already have an agent for but would benefit from given their data sources.`
      : ((): string => {
          // Condense prior history for the model — include both user and assistant turns.
          const priorTurns = (body.history || [])
            .filter((m) => (m.role === 'user' || m.role === 'agent') && m.content)
            .slice(-12)
            .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
            .join('\n\n')
          return priorTurns
            ? `Earlier in this conversation:\n${priorTurns}\n\nNow the user says:\n${message}`
            : message
        })()

interface AgentChatLlmResponse {
  trace?: { label: string; detail?: string }[]
  reply?: string
  intent?: string
  title?: string
  workflowProposal?: {
    name?: string
    description?: string
    department?: string
    title?: string
    steps?: unknown
  }
  switchToAgentId?: string
  editingAgentId?: string
  clarification?: unknown
  apiDiscovery?: unknown
  suggestions?: unknown
}

    let parsed: AgentChatLlmResponse | null = null

    const fallbackCtx = {
      mentionIds,
      agents: agents.map((a) => ({
        id: a.id,
        name: a.name,
        title: a.title,
        department: a.department,
        description: a.description,
      })),
      noLlm: !hasHostedLlmProvider(model),
    }

    if (!hasHostedLlmProvider(model)) {
      // No hosted LLM key — skip the network call and use the local fallback path.
      if (isEmpty) {
        return NextResponse.json({
          ...fallbackResponse('', fallbackCtx),
          trace: [{ label: 'Looked around', detail: 'Read your profile and existing agents.' }],
        } satisfies AgentResponse)
      }
      return NextResponse.json(fallbackResponse(message, fallbackCtx))
    }

    try {
      const text = await simpleComplete({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        model,
        json: true,
      })
      const cleaned = stripFences(text)
      parsed = JSON.parse(cleaned) as AgentChatLlmResponse
    } catch (err) {
      console.error('[api/agent/chat] LLM call/parse failed:', err)
      // Fall through to fallback below.
    }

    // Empty-message path: always return suggestions (fallback if LLM failed).
    if (isEmpty) {
      const suggestions = parsed ? coerceSuggestions(parsed.suggestions) : undefined
      return NextResponse.json({
        reply:
          parsed?.reply ||
          "Hi — I'm your Apical Assistant. Tell me what you'd like to automate, or pick one of these to get started:",
        trace: Array.isArray(parsed?.trace)
          ? parsed!.trace
              .filter((t) => t && typeof t.label === 'string')
              .slice(0, 5)
              .map((t) => ({ label: t.label, detail: t.detail }))
          : [{ label: 'Looked around', detail: 'Read your profile and existing agents.' }],
        intent: 'general',
        suggestions:
          suggestions ||
          (profile
            ? [
                {
                  title: 'Sort my scanner PDFs',
                  prompt:
                    "Sort the PDFs my scanner dumps into /Scan Inbox by client, and file them. Ask me if anything is unclear.",
                  reason: 'You scan paper docs daily — a filing agent saves an hour a week.',
                },
                {
                  title: 'Chase overdue invoices',
                  prompt:
                    'Check unpaid invoices every day. Send a polite reminder if 7 days late; if 30 days, draft an escalation for me to approve.',
                  reason: `You use ${profile.dataSources.some((d) => d.label.toLowerCase().includes('stripe')) ? 'Stripe' : 'your billing system'} — automate the chase for cash flow.`,
                },
                {
                  title: 'Weekly client updates',
                  prompt:
                    'Every Monday, draft a short summary email to each client about last week. Send me the drafts first.',
                  reason: 'Recurring client comms are a perfect first agent.',
                },
              ]
            : undefined),
      } satisfies AgentResponse)
    }

    // Non-empty message but no message validation:
    if (!isEmpty && !message) {
      return NextResponse.json(
        { error: 'message is required' },
        { status: 400 },
      )
    }

    if (!parsed || typeof parsed.reply !== 'string') {
      return NextResponse.json(
        fallbackResponse(message, fallbackCtx),
      )
    }

    // Coerce intent to one of the five valid values.
    const validIntents: Intent[] = [
      'new_agent',
      'edit_existing',
      'general',
      'needs_clarification',
      'needs_api',
    ]
    const intent: Intent = validIntents.includes(parsed.intent as Intent)
      ? (parsed.intent as Intent)
      : 'general'

    const trace = Array.isArray(parsed.trace)
      ? parsed.trace
          .filter((t) => t && typeof t.label === 'string')
          .slice(0, 5)
          .map((t) => ({ label: t.label, detail: t.detail }))
      : []

    const response: AgentResponse = {
      reply: parsed.reply,
      trace,
      intent,
    }

    if (typeof parsed.title === 'string' && parsed.title.trim()) {
      response.title = parsed.title.trim()
    }

    if (intent === 'new_agent') {
      const proposal = parsed.workflowProposal
      const steps = normalizeProposalSteps(proposal?.steps)
      if (steps.length === 0) {
        return NextResponse.json(
          fallbackResponse(message, fallbackCtx),
        )
      }
      // Pick the agent name from the user's preferred style (UserProfile.agentNameStyle).
      // The LLM picks the title and steps — but the NAME comes from generateAgentName.
      const style: AgentNameStyle =
        profileRow?.agentNameStyle === 'evocative' ? 'evocative' : 'descriptive'
      const existingNames = agents.map((a) => a.name)
      const name = await pickAgentName(
        style,
        proposal?.name,
        message || proposal?.description || '',
        existingNames,
      )
      response.workflowProposal = {
        name,
        description:
          typeof proposal?.description === 'string' && proposal.description.trim()
            ? proposal.description.trim()
            : 'A new agent for your workspace.',
        title:
          typeof proposal?.title === 'string' && proposal.title.trim()
            ? proposal.title.trim()
            : 'Agent',
        steps: { version: 1, steps },
      }
    } else if (intent === 'edit_existing') {
      const validIds = new Set(agents.map((a) => a.id))
      const mentionedSet = new Set(mentionIds)
      const llmSwitching =
        typeof parsed.switchToAgentId === 'string' &&
        validIds.has(parsed.switchToAgentId)
          ? parsed.switchToAgentId
          : undefined
      const llmEditing =
        typeof parsed.editingAgentId === 'string' &&
        validIds.has(parsed.editingAgentId)
          ? parsed.editingAgentId
          : undefined

      // @mention model:
      // - If the LLM picked a mentioned agent as editing → use it.
      // - If the LLM picked a non-mentioned agent as editing → that's a switch
      //   (the user tagged A but the LLM thinks they mean B).
      // - If the LLM picked a switch → use it (explicit switch).
      // - If neither was set but there's exactly one mention → edit that one.
      // - If neither was set but there are multiple mentions → leave it to the
      //   frontend to disambiguate (no editing/switch id).
      let switching = llmSwitching
      let editing: string | undefined
      if (llmEditing) {
        if (mentionedSet.has(llmEditing)) {
          editing = llmEditing
        } else if (!switching) {
          switching = llmEditing
        } else {
          editing = llmEditing
        }
      }
      if (!switching && !editing) {
        if (mentionedSet.size === 1) {
          editing = mentionIds[0]
        } else if (mentionedSet.size > 1) {
          // Multiple mentions, no explicit pick — demote to general so the
          // UI asks the user to clarify which agent they mean.
          response.intent = 'general'
        }
      }

      if (response.intent === 'edit_existing') {
        if (switching) response.switchToAgentId = switching
        else if (editing) response.editingAgentId = editing
        else {
          // Couldn't resolve an agent — demote to general so the UI doesn't dead-end.
          response.intent = 'general'
        }
      }
    } else if (intent === 'needs_clarification') {
      const clar = coerceClarification(parsed.clarification)
      if (!clar) {
        // No valid clarification — demote to general so the UI doesn't dead-end.
        response.intent = 'general'
      } else {
        response.clarification = clar
      }
    } else if (intent === 'needs_api') {
      let candidates = coerceApiDiscovery(parsed.apiDiscovery)
      // Ground the discovery in real web research. Use the user's message
      // (or the first candidate's service name) as the query.
      const researchQuery =
        message ||
        (candidates && candidates[0]?.service) ||
        'API'
      let research: ResearchResult | undefined
      try {
        research = await runResearch(researchQuery)
      } catch (err) {
        console.error('[api/agent/chat] runResearch failed:', err)
      }

      // Prefer the LLM's own apiDiscovery (it's grounded in the user's intent
      // + the workspace context). If the LLM produced no candidates but the
      // research surfaced some, use those instead.
      if ((!candidates || candidates.length === 0) && research?.candidates?.length) {
        candidates = research.candidates
      }
      if (!candidates || candidates.length === 0) {
        response.intent = 'general'
      } else {
        response.apiDiscovery = candidates
        if (research) response.research = research
      }
    } else if (intent === 'needs_research') {
      // Deep research: crawl the web, find data sources, propose a workflow.
      try {
        const researchResp = await fetch(`${new URL(req.url).origin}/api/agent/research`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ goal: message, context: undefined }),
        })
        if (researchResp.ok) {
          const plan = await researchResp.json()
          response.researchPlan = plan
          response.reply = response.reply || `I researched "${message}" and found ${plan.findings?.length ?? 0} potential data sources. Here's my proposed strategy and workflow — review it below.`
        }
      } catch (err) {
        console.error('[api/agent/chat] deep research failed:', err)
        response.reply = `I tried to research "${message}" but hit a snag. Could you try rephrasing, or give me more detail about what you're looking for?`
        response.intent = 'general'
      }
    } else if (intent === 'general') {
      // Optional suggestions on a general turn.
      const suggestions = coerceSuggestions(parsed.suggestions)
      if (suggestions) response.suggestions = suggestions
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('[api/agent/chat] failed:', err)
    return NextResponse.json(
      fallbackResponse('', { mentionIds: [] }),
    )
  }
}
