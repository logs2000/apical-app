// Apical LLM gateway — the single routing layer between Apical features
// (chat, agent loops, workflows, research) and every supported model provider.
//
// Three tiers of models (mirroring MODEL_REGISTRY):
//   1. Hosted — Apical holds the provider key in its environment
//      (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY / XAI_API_KEY).
//      We pay the provider and bill the user (costCents > 0). A hosted model is
//      only offered when its provider key is set; otherwise it is hidden.
//   2. BYOK (user's own key, via CustomModel rows) — user pays the provider
//      directly. costCents = 0 (we meter for the dashboard, but don't bill).
//   3. Local (Ollama/llama.cpp) — runs on the user's machine. costCents = 0.
//
// Every call goes through `chat()` (or `chatStream()`) which:
//   - resolves modelId → adapter config (api key, base url, model name)
//   - checks the user's allowance (429-able upstream)
//   - calls the provider
//   - records usage via `recordUsage()` (Subscription + TokenUsageRecord)
//
// All HTTP is plain `fetch`. No axios, no node-fetch. AES-256-GCM via the
// vault module for BYOK keys at rest.

import { db } from '@/lib/db'
import {
  MODEL_REGISTRY,
  HOSTED_PROVIDERS,
  getModel,
  availableModels as registryAvailableModels,
  type ModelDefinition,
  type ProviderId,
} from '@/lib/platform/models'
import { cloudAdapter } from '@/lib/platform/cloud-adapter'
import { entitlements } from '@/lib/platform/entitlements'
import { decrypt, looksLikeKey } from '@/lib/platform/vault'

export const NO_LLM_PROVIDER_ERROR =
  'No AI model available. Connect your Apical token in Settings → Models (ap_pat_…), or set OPENAI_API_KEY locally.'

// ---------------- Public types ----------------

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** A tool the model may call, described in JSON Schema form. */
export interface ToolSpec {
  name: string
  description: string
  /** JSON Schema object: { type:'object', properties: {...}, required: [...] } */
  parameters: Record<string, unknown>
}

/** A completed tool call parsed out of a model response. */
export interface AssistantToolCall {
  /** Provider call id. Synthesized (`call_${i}`) when the provider omits one. */
  id: string
  name: string
  /** Parsed JSON arguments. `__raw` carries the unparsed string on parse failure. */
  arguments: Record<string, unknown>
}

/**
 * Richer message union for agent loops. `ChatMessage` (system/user/assistant
 * with plain string content) is a member, so any existing `ChatMessage[]` is a
 * valid `GatewayMessage[]` and existing chat callers typecheck unchanged.
 */
export type GatewayMessage =
  | ChatMessage
  | {
      role: 'assistant'
      content: string
      toolCalls?: AssistantToolCall[]
      /** Anthropic-only: signed thinking blocks captured from a prior stream,
       *  replayed verbatim when continuing after tool use. */
      thinkingBlocks?: unknown[]
    }
  | { role: 'tool'; toolCallId: string; name: string; content: string }

/** How the model ended its turn. */
export type StopReason = 'end_turn' | 'tool_use' | 'max_tokens' | 'other'

export interface ChatRequest {
  modelId: string
  messages: GatewayMessage[]
  stream?: boolean
  maxTokens?: number
  temperature?: number
  userId: string
  source?: 'chat' | 'agent' | 'workflow' | 'reason' | 'research'
  refId?: string
  /** Native tool-calling: tools the model may invoke this turn. */
  tools?: ToolSpec[]
  /** Anthropic extended thinking. Defaults on for Anthropic streams; set false
   *  for structured/JSON loops that parse the response directly. */
  thinking?: boolean
  /** Aborts the provider fetch — used for per-call timeouts + client disconnect. */
  signal?: AbortSignal
}

export interface ChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatResponse {
  content: string
  usage: ChatUsage
  modelId: string
  provider: string
  costCents: number
}

export interface StreamEvent {
  type: 'delta' | 'thinking_delta' | 'tool_call' | 'done'
  /** Text for `delta` (assistant prose) and `thinking_delta` (reasoning). */
  content?: string
  /** One complete, parsed tool call (emitted when its block finishes). */
  toolCall?: AssistantToolCall
  usage?: ChatUsage
  /** On `done`: how the model ended its turn. */
  stopReason?: StopReason
  /** On `done`: Anthropic signed thinking blocks, for replay after tool use. */
  thinkingBlocks?: unknown[]
}

export interface AllowanceStatus {
  allowed: boolean
  used: number
  allowance: number
  overage: number
  overrunEnabled: boolean
  periodEnd: Date | null
}

export interface RecordUsageParams {
  userId: string
  modelId: string
  provider: string
  promptTokens: number
  completionTokens: number
  costCents: number
  source: string
  refId?: string
}

// ---------------- Internal: resolved model ----------------

export interface ResolvedModel {
  model: ModelDefinition
  adapter: 'openai' | 'anthropic' | 'google' | 'ollama' | 'llamacpp' | 'cloud-relay'
  apiKey?: string
  baseUrl?: string
  isCustom?: boolean
}

/**
 * Whether a resolved model supports native tool calling. Every adapter except
 * llama.cpp does; registry models that explicitly opt out (supportsTools:false)
 * are respected for direct providers (the cloud relay decides remotely).
 */
export function modelSupportsTools(resolved: ResolvedModel): boolean {
  if (resolved.adapter === 'llamacpp') return false
  if (resolved.adapter === 'cloud-relay') return true
  return resolved.model.supportsTools !== false
}

interface ChatOpts {
  maxTokens?: number
  temperature?: number
  json?: boolean
  /** Native tool-calling: tools the model may invoke. */
  tools?: ToolSpec[]
  /** Enable Anthropic extended thinking (chain-of-thought). Default on for Anthropic streams. */
  thinking?: boolean
  thinkingBudgetTokens?: number
  /** Abort the underlying provider fetch (client disconnect or per-call timeout). */
  signal?: AbortSignal
}

interface AdapterResult {
  content: string
  usage: ChatUsage
  /** Native tool calls the model made (streaming + non-streaming). */
  toolCalls?: AssistantToolCall[]
  /** How the model ended its turn. */
  stopReason?: StopReason
  /** Anthropic signed thinking blocks (for replay after tool use). */
  thinkingBlocks?: unknown[]
}

interface AdapterStreamChunk {
  delta?: string
  thinkingDelta?: string
  /** One complete parsed tool call. */
  toolCall?: AssistantToolCall
  done?: AdapterResult
}

// ---------------- Internal: subscription helpers ----------------

/** Get-or-create the user's Subscription. A fresh dev user has none yet. */
async function getOrCreateSubscription(userId: string) {
  let sub = await db.subscription.findUnique({ where: { userId } })
  if (!sub) {
    const periodEnd = new Date()
    periodEnd.setDate(periodEnd.getDate() + 30)
    sub = await db.subscription.create({
      data: {
        userId,
        plan: 'free',
        status: 'active',
        tokenAllowanceMonthly: entitlements().defaultTokenAllowance,
        currentPeriodEnd: periodEnd,
      },
    })
  }
  return sub
}

// ---------------- Model resolution ----------------

/**
 * Resolve a modelId to an adapter + credentials.
 *
 * Order:
 *   1. CustomModel row (matched by `id`) — use it. If type=online, load its
 *      ByokKey and decrypt. If type=offline, use its baseUrl.
 *   2. MODEL_REGISTRY entry — hosted models load the provider key from our env
 *      (and resolve to null if it's missing); local models use
 *      OLLAMA_BASE_URL / LLAMACPP_BASE_URL env.
 *
 * Returns null if the model is unknown or its provider key isn't configured.
 */
export async function resolveModel(
  userId: string,
  modelId: string,
): Promise<ResolvedModel | null> {
  // 1. CustomModel lookup.
  const custom = await db.customModel.findFirst({
    where: { id: modelId, userId, enabled: true },
  })
  if (custom) {
    let apiKey: string | undefined
    let baseUrl: string | undefined
    let adapter: ResolvedModel['adapter'] | null = null
    let tier: ModelDefinition['tier'] = 'byok'

    if (custom.type === 'online') {
      tier = 'byok'
      if (custom.byokKeyId) {
        const byok = await db.byokKey.findUnique({
          where: { id: custom.byokKeyId },
        })
        if (byok && byok.status === 'active') {
          try {
            apiKey = decrypt(byok.encryptedKey)
          } catch {
            apiKey = undefined
          }
          baseUrl = byok.baseUrl ?? undefined
        }
      }
      adapter = pickAdapter(custom.provider as ProviderId)
      if (!adapter) return null
      if (!apiKey) return null
    } else if (custom.type === 'offline') {
      tier = 'local'
      baseUrl = custom.baseUrl ?? undefined
      adapter = custom.provider === 'llamacpp' ? 'llamacpp' : 'ollama'
    } else {
      // type === 'hosted'
      tier = 'hosted'
      const env = pickHostedEnv(custom.provider as ProviderId)
      if (env) {
        apiKey = env.apiKey
        baseUrl = env.baseUrl
        adapter = env.adapter
      } else if (await cloudAdapter()?.isAvailable(userId)) {
        adapter = 'cloud-relay'
      } else {
        return null
      }
    }

    if (!adapter) return null

    const model: ModelDefinition = {
      id: custom.id,
      name: custom.name,
      provider: custom.provider as ProviderId,
      tier,
      apiModelId: custom.modelId,
      contextWindow: custom.contextWindow,
      inputCostCentsPer1M: custom.inputCostCentsPer1M,
      outputCostCentsPer1M: custom.outputCostCentsPer1M,
      supportsStreaming: true,
      // Native tool calling works for every adapter except llama.cpp.
      supportsTools: adapter !== 'llamacpp',
      supportsVision: false,
      description: 'User-defined model',
    }
    return { model, adapter, apiKey, baseUrl, isCustom: true }
  }

  // 2. MODEL_REGISTRY lookup.
  const model = getModel(modelId)
  if (!model) return null

  if (model.tier === 'hosted') {
    const env = pickHostedEnv(model.provider)
    if (env) {
      return { model, adapter: env.adapter, apiKey: env.apiKey, baseUrl: env.baseUrl }
    }
    if (await cloudAdapter()?.isAvailable(userId)) {
      return { model, adapter: 'cloud-relay' }
    }
    return null
  }

  // Local.
  if (model.provider === 'ollama') {
    return {
      model,
      adapter: 'ollama',
      baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
    }
  }
  if (model.provider === 'llamacpp') {
    return {
      model,
      adapter: 'llamacpp',
      baseUrl: process.env.LLAMACPP_BASE_URL || 'http://localhost:8080',
    }
  }
  // vLLM exposes an OpenAI-compatible endpoint.
  if (model.provider === 'vllm') {
    return {
      model,
      adapter: 'openai',
      baseUrl: process.env.VLLM_BASE_URL || 'http://localhost:8000/v1',
    }
  }

  return null
}

function pickAdapter(provider: ProviderId): ResolvedModel['adapter'] | null {
  switch (provider) {
    case 'openai':
    case 'azure_openai':
    case 'openrouter':
    case 'mistral':
    case 'groq':
    case 'together':
    case 'xai':
    case 'vllm':
      return 'openai'
    case 'anthropic':
      return 'anthropic'
    case 'google':
      return 'google'
    case 'ollama':
      return 'ollama'
    case 'llamacpp':
      return 'llamacpp'
    default:
      return null
  }
}

function pickHostedEnv(provider: ProviderId): {
  provider: ProviderId
  adapter: ResolvedModel['adapter']
  apiKey: string
  baseUrl?: string
} | null {
  switch (provider) {
    case 'openai': {
      const k = process.env.OPENAI_API_KEY
      if (!k) return null
      return {
        provider: 'openai',
        adapter: 'openai',
        apiKey: k,
        baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      }
    }
    case 'anthropic': {
      const k = process.env.ANTHROPIC_API_KEY
      if (!k) return null
      return {
        provider: 'anthropic',
        adapter: 'anthropic',
        apiKey: k,
        baseUrl: process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
      }
    }
    case 'google': {
      const k = process.env.GOOGLE_API_KEY
      if (!k) return null
      return {
        provider: 'google',
        adapter: 'google',
        apiKey: k,
      }
    }
    case 'xai': {
      const k = process.env.XAI_API_KEY
      if (!k) return null
      return {
        provider: 'xai',
        adapter: 'openai', // xAI exposes an OpenAI-compatible endpoint.
        apiKey: k,
        baseUrl: process.env.XAI_BASE_URL || 'https://api.x.ai/v1',
      }
    }
    default:
      return null
  }
}

/** Hosted providers whose API key is present in our environment. */
export function configuredHostedProviders(): ProviderId[] {
  return HOSTED_PROVIDERS.filter((p) => pickHostedEnv(p) !== null)
}

/** Local env keys, or all hosted providers when cloud relay is linked. */
export async function hostedProvidersForUser(userId: string): Promise<ProviderId[]> {
  const local = configuredHostedProviders()
  if (local.length > 0) return local
  if (await cloudAdapter()?.isAvailable(userId)) return [...HOSTED_PROVIDERS]
  return []
}

/**
 * The default hosted model id for the current environment: the first model in
 * the registry whose provider key is configured. Returns null if no hosted
 * provider key is set.
 */
export function getDefaultModelId(): string | null {
  const configured = configuredHostedProviders()
  const model = MODEL_REGISTRY.find(
    (m) => m.tier === 'hosted' && configured.includes(m.provider),
  )
  return model?.id ?? null
}

// ---------------- Cost computation ----------------

function computeCost(model: ModelDefinition, usage: ChatUsage): number {
  if (model.tier !== 'hosted') return 0
  const input = (usage.promptTokens * model.inputCostCentsPer1M) / 1_000_000
  const output = (usage.completionTokens * model.outputCostCentsPer1M) / 1_000_000
  return Math.ceil(input + output)
}

// ---------------- Token estimation (when providers omit usage) ----------------

function estimateUsage(messages: GatewayMessage[], completion: string): ChatUsage {
  const promptTokens = Math.ceil(JSON.stringify(messages).length / 4)
  const completionTokens = Math.ceil(completion.length / 4)
  return {
    promptTokens,
    completionTokens,
    totalTokens: promptTokens + completionTokens,
  }
}

// ---------------- Message + tool conversion ----------------

type GatewayAssistant = Extract<GatewayMessage, { role: 'assistant' }>
type GatewayTool = Extract<GatewayMessage, { role: 'tool' }>

function isToolMsg(m: GatewayMessage): m is GatewayTool {
  return m.role === 'tool'
}
function assistantToolCalls(m: GatewayMessage): AssistantToolCall[] | undefined {
  return m.role === 'assistant' ? (m as GatewayAssistant).toolCalls : undefined
}

/** Strip the `__raw` sentinel we attach when argument JSON fails to parse. */
function cleanArgs(args: Record<string, unknown>): Record<string, unknown> {
  if (args && typeof args === 'object' && '__raw' in args) {
    const { __raw, ...rest } = args as Record<string, unknown>
    void __raw
    return rest
  }
  return args
}

// -- OpenAI --

function toOpenAIMessages(messages: GatewayMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (isToolMsg(m)) {
      return { role: 'tool', tool_call_id: m.toolCallId, content: m.content }
    }
    const calls = assistantToolCalls(m)
    if (m.role === 'assistant' && calls && calls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || null,
        tool_calls: calls.map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(cleanArgs(c.arguments)) },
        })),
      }
    }
    return { role: m.role, content: (m as ChatMessage).content }
  })
}

function toOpenAITools(tools?: ToolSpec[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    type: 'function',
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }))
}

// -- Anthropic --

/** Coalesce consecutive `tool` messages into a single user turn of
 *  tool_result blocks, and expand assistant tool calls into content blocks
 *  (replaying signed thinking blocks first when present). */
function toAnthropicMessages(messages: GatewayMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  let i = 0
  const nonSystem = messages.filter((m) => m.role !== 'system')
  while (i < nonSystem.length) {
    const m = nonSystem[i]
    if (isToolMsg(m)) {
      const results: Record<string, unknown>[] = []
      while (i < nonSystem.length && isToolMsg(nonSystem[i])) {
        const t = nonSystem[i] as GatewayTool
        results.push({ type: 'tool_result', tool_use_id: t.toolCallId, content: t.content })
        i++
      }
      out.push({ role: 'user', content: results })
      continue
    }
    if (m.role === 'assistant') {
      const calls = assistantToolCalls(m)
      const thinking = (m as GatewayAssistant).thinkingBlocks
      if ((calls && calls.length > 0) || (thinking && thinking.length > 0)) {
        const blocks: unknown[] = []
        if (thinking && thinking.length > 0) blocks.push(...thinking)
        if (m.content) blocks.push({ type: 'text', text: m.content })
        for (const c of calls ?? []) {
          blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: cleanArgs(c.arguments) })
        }
        out.push({ role: 'assistant', content: blocks })
        i++
        continue
      }
      out.push({ role: 'assistant', content: m.content })
      i++
      continue
    }
    // user
    out.push({ role: 'user', content: (m as ChatMessage).content })
    i++
  }
  return out
}

function toAnthropicTools(tools?: ToolSpec[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.parameters,
  }))
}

// -- Google (Gemini) --

/** Gemini rejects several JSON Schema keywords — strip them recursively. */
function sanitizeForGemini(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeForGemini)
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (k === 'additionalProperties' || k === '$schema' || k === 'default') continue
      out[k] = sanitizeForGemini(v)
    }
    return out
  }
  return schema
}

function toGoogleContents(messages: GatewayMessage[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const m of messages) {
    if (m.role === 'system') continue
    if (isToolMsg(m)) {
      out.push({
        role: 'user',
        parts: [{ functionResponse: { name: m.name, response: { result: m.content } } }],
      })
      continue
    }
    if (m.role === 'assistant') {
      const calls = assistantToolCalls(m)
      const parts: Record<string, unknown>[] = []
      if (m.content) parts.push({ text: m.content })
      for (const c of calls ?? []) {
        parts.push({ functionCall: { name: c.name, args: cleanArgs(c.arguments) } })
      }
      out.push({ role: 'model', parts: parts.length ? parts : [{ text: '' }] })
      continue
    }
    out.push({ role: 'user', parts: [{ text: (m as ChatMessage).content }] })
  }
  return out
}

function toGoogleTools(tools?: ToolSpec[]): Record<string, unknown>[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: sanitizeForGemini(t.parameters),
      })),
    },
  ]
}

// -- Ollama --

function toOllamaMessages(messages: GatewayMessage[]): Record<string, unknown>[] {
  return messages.map((m) => {
    if (isToolMsg(m)) return { role: 'tool', content: m.content }
    const calls = assistantToolCalls(m)
    if (m.role === 'assistant' && calls && calls.length > 0) {
      return {
        role: 'assistant',
        content: m.content || '',
        tool_calls: calls.map((c) => ({
          function: { name: c.name, arguments: cleanArgs(c.arguments) },
        })),
      }
    }
    return { role: m.role, content: (m as ChatMessage).content }
  })
}

// ---------------- Provider adapters ----------------

/** OpenAI Chat Completions — also used for OpenAI-compatible endpoints. */
async function callOpenAI(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: GatewayMessage[],
  opts: ChatOpts,
): Promise<AdapterResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(messages),
    stream: false,
  }
  if (typeof opts.maxTokens === 'number') body.max_tokens = opts.maxTokens
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature
  if (opts.json) body.response_format = { type: 'json_object' }
  const tools = toOpenAITools(opts.tools)
  if (tools) body.tools = tools

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI API ${res.status}: ${text.slice(0, 500)}`)
  }
  const json = (await res.json()) as {
    choices?: Array<{
      message?: {
        content?: string
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>
      }
      finish_reason?: string
    }>
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
  }
  const choice = json.choices?.[0]
  const content = choice?.message?.content ?? ''
  const toolCalls: AssistantToolCall[] = (choice?.message?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id || `call_${i}`,
    name: tc.function?.name || '',
    arguments: parseToolArgs(tc.function?.arguments ?? ''),
  }))
  const usage: ChatUsage = {
    promptTokens: json.usage?.prompt_tokens ?? 0,
    completionTokens: json.usage?.completion_tokens ?? 0,
    totalTokens: json.usage?.total_tokens ?? 0,
  }
  return {
    content,
    usage,
    toolCalls: toolCalls.length ? toolCalls : undefined,
    stopReason: choice?.finish_reason === 'tool_calls' ? 'tool_use' : mapStop(choice?.finish_reason),
  }
}

/** Parse tool-call argument JSON; keep the raw string under `__raw` on failure. */
function parseToolArgs(raw: string): Record<string, unknown> {
  if (!raw || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { __raw: raw }
  } catch {
    return { __raw: raw }
  }
}

function mapStop(reason?: string): StopReason {
  switch (reason) {
    case 'stop':
    case 'end_turn':
      return 'end_turn'
    case 'tool_calls':
    case 'tool_use':
      return 'tool_use'
    case 'length':
    case 'max_tokens':
      return 'max_tokens'
    default:
      return reason ? 'other' : 'end_turn'
  }
}

const TRANSIENT_HTTP = new Set([502, 503, 504])

/** Retry once on transient upstream failures (common with Anthropic 503). */
async function fetchWithTransientRetry(url: string, init: RequestInit): Promise<Response> {
  let res = await fetch(url, init)
  if (TRANSIENT_HTTP.has(res.status)) {
    await new Promise((r) => setTimeout(r, 1500))
    res = await fetch(url, init)
  }
  return res
}

/** Anthropic Messages API. */
async function callAnthropic(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: GatewayMessage[],
  opts: ChatOpts,
): Promise<AdapterResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`
  // Anthropic separates `system` from the messages array.
  const systemMsgs = messages.filter((m) => m.role === 'system')
  const body: Record<string, unknown> = {
    model,
    messages: toAnthropicMessages(messages),
    max_tokens: opts.maxTokens ?? 1024,
  }
  if (systemMsgs.length) {
    body.system = systemMsgs.map((m) => (m as ChatMessage).content).join('\n\n')
  }
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature
  const tools = toAnthropicTools(opts.tools)
  if (tools) body.tools = tools

  const res = await fetchWithTransientRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic API ${res.status}: ${text.slice(0, 500)}`)
  }
  const json = (await res.json()) as {
    content?: Array<{ type?: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }>
    stop_reason?: string
    usage?: { input_tokens?: number; output_tokens?: number }
  }
  const blocks = json.content ?? []
  const content = blocks
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
  const toolCalls: AssistantToolCall[] = blocks
    .filter((b) => b.type === 'tool_use')
    .map((b, i) => ({ id: b.id || `call_${i}`, name: b.name || '', arguments: b.input ?? {} }))
  const thinkingBlocks = blocks.filter((b) => b.type === 'thinking' || b.type === 'redacted_thinking')
  const promptTokens = json.usage?.input_tokens ?? 0
  const completionTokens = json.usage?.output_tokens ?? 0
  return {
    content,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
    toolCalls: toolCalls.length ? toolCalls : undefined,
    thinkingBlocks: thinkingBlocks.length ? thinkingBlocks : undefined,
    stopReason: mapStop(json.stop_reason),
  }
}

/** Google Generative Language API (Gemini). */
async function callGoogle(
  apiKey: string,
  _baseUrl: string | undefined,
  model: string,
  messages: GatewayMessage[],
  opts: ChatOpts,
): Promise<AdapterResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`
  // Google's "contents" array doesn't have system role; systemInstruction is separate.
  const systemText = messages
    .filter((m) => m.role === 'system')
    .map((m) => (m as ChatMessage).content)
    .join('\n\n')
  const contents = toGoogleContents(messages)
  const body: Record<string, unknown> = { contents }
  if (systemText) body.systemInstruction = { parts: [{ text: systemText }] }
  const tools = toGoogleTools(opts.tools)
  if (tools) body.tools = tools
  const genConfig: Record<string, unknown> = {}
  if (typeof opts.maxTokens === 'number') genConfig.maxOutputTokens = opts.maxTokens
  if (typeof opts.temperature === 'number') genConfig.temperature = opts.temperature
  if (Object.keys(genConfig).length) body.generationConfig = genConfig

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Google API ${res.status}: ${text.slice(0, 500)}`)
  }
  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string; functionCall?: { name?: string; args?: Record<string, unknown> } }> }
      finishReason?: string
    }>
    usageMetadata?: {
      promptTokenCount?: number
      candidatesTokenCount?: number
      totalTokenCount?: number
    }
  }
  const parts = json.candidates?.[0]?.content?.parts ?? []
  const content = parts.map((p) => p.text ?? '').join('')
  const toolCalls: AssistantToolCall[] = parts
    .filter((p) => p.functionCall)
    .map((p, i) => ({ id: `call_${i}`, name: p.functionCall?.name || '', arguments: p.functionCall?.args ?? {} }))
  const promptTokens = json.usageMetadata?.promptTokenCount ?? 0
  const completionTokens = json.usageMetadata?.candidatesTokenCount ?? 0
  return {
    content,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: json.usageMetadata?.totalTokenCount ?? promptTokens + completionTokens,
    },
    toolCalls: toolCalls.length ? toolCalls : undefined,
    stopReason: toolCalls.length ? 'tool_use' : mapStop(json.candidates?.[0]?.finishReason?.toLowerCase()),
  }
}

/** Ollama /api/chat — OpenAI-style but local. */
async function callOllama(
  baseUrl: string,
  model: string,
  messages: GatewayMessage[],
  opts: ChatOpts,
): Promise<AdapterResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`
  const body: Record<string, unknown> = {
    model,
    messages: toOllamaMessages(messages),
    stream: false,
  }
  const tools = toOpenAITools(opts.tools)
  if (tools) body.tools = tools
  const options: Record<string, unknown> = {}
  if (typeof opts.maxTokens === 'number') options.num_predict = opts.maxTokens
  if (typeof opts.temperature === 'number') options.temperature = opts.temperature
  if (Object.keys(options).length) body.options = options

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama API ${res.status}: ${text.slice(0, 500)}`)
  }
  const json = (await res.json()) as {
    message?: {
      content?: string
      tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>
    }
    prompt_eval_count?: number
    eval_count?: number
  }
  const toolCalls: AssistantToolCall[] = (json.message?.tool_calls ?? []).map((tc, i) => ({
    id: `call_${i}`,
    name: tc.function?.name || '',
    arguments: tc.function?.arguments ?? {},
  }))
  return {
    content: json.message?.content ?? '',
    usage: {
      promptTokens: json.prompt_eval_count ?? 0,
      completionTokens: json.eval_count ?? 0,
      totalTokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
    },
    toolCalls: toolCalls.length ? toolCalls : undefined,
    stopReason: toolCalls.length ? 'tool_use' : 'end_turn',
  }
}

// ---------------- Streaming adapters ----------------

async function* streamOpenAI(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: GatewayMessage[],
  opts: ChatOpts,
): AsyncGenerator<AdapterStreamChunk> {
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`
  const body: Record<string, unknown> = {
    model,
    messages: toOpenAIMessages(messages),
    stream: true,
    stream_options: { include_usage: true },
  }
  if (typeof opts.maxTokens === 'number') body.max_tokens = opts.maxTokens
  if (typeof opts.temperature === 'number') body.temperature = opts.temperature
  if (opts.json) body.response_format = { type: 'json_object' }
  const tools = toOpenAITools(opts.tools)
  if (tools) body.tools = tools

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenAI stream ${res.status}: ${text.slice(0, 500)}`)
  }

  let promptTokens = 0
  let completionTokens = 0
  let totalTokens = 0
  let stopReason: StopReason = 'end_turn'
  // Accumulate streamed tool-call fragments by their delta index.
  const toolAccum = new Map<number, { id: string; name: string; args: string }>()
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try {
        const ev = JSON.parse(payload) as {
          choices?: Array<{
            delta?: {
              content?: string
              tool_calls?: Array<{
                index?: number
                id?: string
                function?: { name?: string; arguments?: string }
              }>
            }
            finish_reason?: string
          }>
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
        }
        const choice = ev.choices?.[0]
        const delta = choice?.delta?.content
        if (delta) yield { delta }
        for (const tc of choice?.delta?.tool_calls ?? []) {
          const idx = tc.index ?? 0
          const acc = toolAccum.get(idx) ?? { id: '', name: '', args: '' }
          if (tc.id) acc.id = tc.id
          if (tc.function?.name) acc.name = tc.function.name
          if (tc.function?.arguments) acc.args += tc.function.arguments
          toolAccum.set(idx, acc)
        }
        if (choice?.finish_reason) stopReason = mapStop(choice.finish_reason)
        if (ev.usage) {
          promptTokens = ev.usage.prompt_tokens ?? promptTokens
          completionTokens = ev.usage.completion_tokens ?? completionTokens
          totalTokens = ev.usage.total_tokens ?? totalTokens
        }
      } catch {
        // Skip unparseable lines.
      }
    }
  }

  const toolCalls: AssistantToolCall[] = [...toolAccum.entries()]
    .sort(([a], [b]) => a - b)
    .map(([idx, acc]) => ({
      id: acc.id || `call_${idx}`,
      name: acc.name,
      arguments: parseToolArgs(acc.args),
    }))
  for (const tc of toolCalls) yield { toolCall: tc }
  if (toolCalls.length > 0 && stopReason !== 'max_tokens') stopReason = 'tool_use'

  yield {
    done: {
      content: '',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: totalTokens || promptTokens + completionTokens,
      },
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason,
    },
  }
}

async function* streamAnthropic(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: GatewayMessage[],
  opts: ChatOpts,
): AsyncGenerator<AdapterStreamChunk> {
  const url = `${baseUrl.replace(/\/$/, '')}/v1/messages`
  const systemMsgs = messages.filter((m) => m.role === 'system')
  const thinkingBudget = opts.thinkingBudgetTokens ?? 8_000
  const maxTokens = opts.maxTokens ?? 16_000
  const body: Record<string, unknown> = {
    model,
    messages: toAnthropicMessages(messages),
    max_tokens: Math.max(maxTokens, thinkingBudget + 1_024),
    stream: true,
  }
  const thinkingEnabled = opts.thinking !== false
  if (thinkingEnabled) {
    body.thinking = { type: 'enabled', budget_tokens: thinkingBudget }
  }
  if (systemMsgs.length) {
    body.system = systemMsgs.map((m) => (m as ChatMessage).content).join('\n\n')
  }
  // Anthropic rejects any temperature other than 1 while extended thinking is
  // enabled. Only forward a custom temperature when thinking is OFF; otherwise
  // omit it and let the API default to 1.
  if (typeof opts.temperature === 'number' && !thinkingEnabled) {
    body.temperature = opts.temperature
  }
  const tools = toAnthropicTools(opts.tools)
  if (tools) body.tools = tools

  const res = await fetchWithTransientRetry(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Anthropic stream ${res.status}: ${text.slice(0, 500)}`)
  }

  let promptTokens = 0
  let completionTokens = 0
  let stopReason: StopReason = 'end_turn'
  // Track the current content block by index so we can assemble tool_use inputs
  // and reconstruct signed thinking blocks for replay after tool use.
  type BlockAcc =
    | { kind: 'text' }
    | { kind: 'tool_use'; id: string; name: string; json: string }
    | { kind: 'thinking'; thinking: string; signature: string }
    | { kind: 'redacted_thinking'; data: string }
    | { kind: 'other' }
  const blocks = new Map<number, BlockAcc>()
  const toolCalls: AssistantToolCall[] = []
  const thinkingBlocks: unknown[] = []
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload) continue
      try {
        const ev = JSON.parse(payload) as {
          type?: string
          index?: number
          content_block?: { type?: string; id?: string; name?: string; data?: string }
          delta?: {
            type?: string
            text?: string
            thinking?: string
            signature?: string
            partial_json?: string
            stop_reason?: string
          }
          message?: { usage?: { input_tokens?: number } }
          usage?: { input_tokens?: number; output_tokens?: number }
        }
        if (ev.type === 'content_block_start' && typeof ev.index === 'number') {
          const cb = ev.content_block
          if (cb?.type === 'tool_use') {
            blocks.set(ev.index, { kind: 'tool_use', id: cb.id || `call_${ev.index}`, name: cb.name || '', json: '' })
          } else if (cb?.type === 'thinking') {
            blocks.set(ev.index, { kind: 'thinking', thinking: '', signature: '' })
          } else if (cb?.type === 'redacted_thinking') {
            blocks.set(ev.index, { kind: 'redacted_thinking', data: cb.data || '' })
          } else if (cb?.type === 'text') {
            blocks.set(ev.index, { kind: 'text' })
          } else {
            blocks.set(ev.index, { kind: 'other' })
          }
        } else if (ev.type === 'content_block_delta' && ev.delta && typeof ev.index === 'number') {
          const acc = blocks.get(ev.index)
          if (ev.delta.type === 'thinking_delta' && ev.delta.thinking) {
            if (acc?.kind === 'thinking') acc.thinking += ev.delta.thinking
            yield { thinkingDelta: ev.delta.thinking }
          } else if (ev.delta.type === 'signature_delta' && ev.delta.signature) {
            if (acc?.kind === 'thinking') acc.signature += ev.delta.signature
          } else if (ev.delta.type === 'input_json_delta' && ev.delta.partial_json) {
            if (acc?.kind === 'tool_use') acc.json += ev.delta.partial_json
          } else if (ev.delta.type === 'text_delta' && ev.delta.text) {
            yield { delta: ev.delta.text }
          } else if (ev.delta.text) {
            yield { delta: ev.delta.text }
          }
        } else if (ev.type === 'content_block_stop' && typeof ev.index === 'number') {
          const acc = blocks.get(ev.index)
          if (acc?.kind === 'tool_use') {
            const call: AssistantToolCall = { id: acc.id, name: acc.name, arguments: parseToolArgs(acc.json) }
            toolCalls.push(call)
            yield { toolCall: call }
          } else if (acc?.kind === 'thinking') {
            thinkingBlocks.push({ type: 'thinking', thinking: acc.thinking, signature: acc.signature })
          } else if (acc?.kind === 'redacted_thinking') {
            thinkingBlocks.push({ type: 'redacted_thinking', data: acc.data })
          }
        } else if (ev.type === 'message_start' && ev.message?.usage?.input_tokens) {
          promptTokens = ev.message.usage.input_tokens
        } else if (ev.type === 'message_delta') {
          if (ev.usage?.output_tokens) completionTokens = ev.usage.output_tokens
          if (ev.delta?.stop_reason) stopReason = mapStop(ev.delta.stop_reason)
        }
      } catch {
        // Skip.
      }
    }
  }
  yield {
    done: {
      content: '',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      toolCalls: toolCalls.length ? toolCalls : undefined,
      thinkingBlocks: thinkingBlocks.length ? thinkingBlocks : undefined,
      stopReason,
    },
  }
}

async function* streamOllama(
  baseUrl: string,
  model: string,
  messages: GatewayMessage[],
  opts: ChatOpts,
): AsyncGenerator<AdapterStreamChunk> {
  const url = `${baseUrl.replace(/\/$/, '')}/api/chat`
  const body: Record<string, unknown> = {
    model,
    messages: toOllamaMessages(messages),
    stream: true,
  }
  const tools = toOpenAITools(opts.tools)
  if (tools) body.tools = tools
  const options: Record<string, unknown> = {}
  if (typeof opts.maxTokens === 'number') options.num_predict = opts.maxTokens
  if (typeof opts.temperature === 'number') options.temperature = opts.temperature
  if (Object.keys(options).length) body.options = options

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: opts.signal,
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`Ollama stream ${res.status}: ${text.slice(0, 500)}`)
  }

  let promptTokens = 0
  let completionTokens = 0
  const toolCalls: AssistantToolCall[] = []
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // Ollama streams newline-delimited JSON objects.
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const ev = JSON.parse(trimmed) as {
          message?: {
            content?: string
            tool_calls?: Array<{ function?: { name?: string; arguments?: Record<string, unknown> } }>
          }
          prompt_eval_count?: number
          eval_count?: number
          done?: boolean
        }
        if (ev.message?.content) yield { delta: ev.message.content }
        for (const tc of ev.message?.tool_calls ?? []) {
          const call: AssistantToolCall = {
            id: `call_${toolCalls.length}`,
            name: tc.function?.name || '',
            arguments: tc.function?.arguments ?? {},
          }
          toolCalls.push(call)
          yield { toolCall: call }
        }
        if (ev.done) {
          promptTokens = ev.prompt_eval_count ?? promptTokens
          completionTokens = ev.eval_count ?? completionTokens
        }
      } catch {
        // Skip.
      }
    }
  }
  yield {
    done: {
      content: '',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
      toolCalls: toolCalls.length ? toolCalls : undefined,
      stopReason: toolCalls.length ? 'tool_use' : 'end_turn',
    },
  }
}

// ---------------- Adapter dispatch ----------------

async function callAdapter(
  resolved: ResolvedModel,
  messages: GatewayMessage[],
  opts: ChatOpts,
  userId?: string,
): Promise<AdapterResult> {
  if (resolved.adapter === 'cloud-relay') {
    if (!userId) throw new Error('Cloud relay requires userId')
    const cloud = cloudAdapter()
    if (!cloud) throw new Error('Cloud relay is not available in this build')
    const res = await cloud.chat(userId, {
      modelId: resolved.model.id,
      messages,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      tools: opts.tools,
      thinking: opts.thinking,
    })
    return { content: res.content, usage: res.usage }
  }

  switch (resolved.adapter) {
    case 'openai':
      if (!resolved.apiKey) throw new Error('OpenAI API key not configured')
      return callOpenAI(
        resolved.apiKey,
        resolved.baseUrl || 'https://api.openai.com/v1',
        resolved.model.apiModelId,
        messages,
        opts,
      )
    case 'anthropic':
      if (!resolved.apiKey) throw new Error('Anthropic API key not configured')
      return callAnthropic(
        resolved.apiKey,
        resolved.baseUrl || 'https://api.anthropic.com',
        resolved.model.apiModelId,
        messages,
        opts,
      )
    case 'google':
      if (!resolved.apiKey) throw new Error('Google API key not configured')
      return callGoogle(
        resolved.apiKey,
        resolved.baseUrl,
        resolved.model.apiModelId,
        messages,
        opts,
      )
    case 'ollama':
      return callOllama(
        resolved.baseUrl || 'http://localhost:11434',
        resolved.model.apiModelId,
        messages,
        opts,
      )
    case 'llamacpp':
      // llama.cpp exposes an OpenAI-compatible endpoint.
      return callOpenAI(
        resolved.apiKey || 'no-key',
        resolved.baseUrl || 'http://localhost:8080',
        resolved.model.apiModelId,
        messages,
        opts,
      )
    default:
      throw new Error(`Unsupported adapter: ${(resolved as ResolvedModel).adapter}`)
  }
}

async function* streamAdapter(
  resolved: ResolvedModel,
  messages: GatewayMessage[],
  opts: ChatOpts,
  userId?: string,
): AsyncGenerator<AdapterStreamChunk> {
  if (resolved.adapter === 'cloud-relay') {
    if (!userId) throw new Error('Cloud relay requires userId')
    const cloud = cloudAdapter()
    if (!cloud) throw new Error('Cloud relay is not available in this build')
    let usage: ChatUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
    let content = ''
    const toolCalls: AssistantToolCall[] = []
    let thinkingBlocks: unknown[] | undefined
    let stopReason: StopReason | undefined
    for await (const ev of cloud.chatStream(userId, {
      modelId: resolved.model.id,
      messages,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
      tools: opts.tools,
      thinking: opts.thinking,
    })) {
      if (ev.type === 'delta' && ev.content) {
        content += ev.content
        yield { delta: ev.content }
      } else if (ev.type === 'thinking_delta' && ev.content) {
        yield { thinkingDelta: ev.content }
      } else if (ev.type === 'tool_call' && ev.toolCall) {
        toolCalls.push(ev.toolCall)
        yield { toolCall: ev.toolCall }
      } else if (ev.type === 'done') {
        if (ev.usage) usage = ev.usage
        if (ev.thinkingBlocks) thinkingBlocks = ev.thinkingBlocks
        if (ev.stopReason) stopReason = ev.stopReason
      }
    }
    yield {
      done: {
        content,
        usage,
        toolCalls: toolCalls.length ? toolCalls : undefined,
        thinkingBlocks,
        stopReason,
      },
    }
    return
  }

  switch (resolved.adapter) {
    case 'openai':
      if (!resolved.apiKey) throw new Error('OpenAI API key not configured')
      yield* streamOpenAI(
        resolved.apiKey,
        resolved.baseUrl || 'https://api.openai.com/v1',
        resolved.model.apiModelId,
        messages,
        opts,
      )
      return
    case 'anthropic':
      if (!resolved.apiKey) throw new Error('Anthropic API key not configured')
      yield* streamAnthropic(
        resolved.apiKey,
        resolved.baseUrl || 'https://api.anthropic.com',
        resolved.model.apiModelId,
        messages,
        { ...opts, thinking: opts.thinking ?? true },
      )
      return
    case 'ollama':
      yield* streamOllama(
        resolved.baseUrl || 'http://localhost:11434',
        resolved.model.apiModelId,
        messages,
        opts,
      )
      return
    case 'llamacpp':
      // llama.cpp's OpenAI-compatible endpoint supports /chat/completions stream=true.
      yield* streamOpenAI(
        resolved.apiKey || 'no-key',
        resolved.baseUrl || 'http://localhost:8080',
        resolved.model.apiModelId,
        messages,
        opts,
      )
      return
    case 'google':
      // Google streaming not implemented — fall back to non-streaming.
      {
        const result = await callGoogle(
          resolved.apiKey!,
          resolved.baseUrl,
          resolved.model.apiModelId,
          messages,
          opts,
        )
        if (result.content) yield { delta: result.content }
        for (const tc of result.toolCalls ?? []) yield { toolCall: tc }
        yield { done: result }
      }
      return
    default:
      throw new Error(`Unsupported adapter: ${resolved.adapter}`)
  }
}

// ---------------- Allowance + usage recording ----------------

export async function checkAllowance(userId: string): Promise<AllowanceStatus> {
  const ent = entitlements()
  const sub = await getOrCreateSubscription(userId)
  const features = ent.planFeatures(sub.plan)
  const allowance = await ent.effectiveAllowance(sub)
  const used = sub.tokenUsedMonthly
  const overage = Math.max(0, used - allowance)
  const overrunEnabled = sub.overrunEnabled && features.overrunAvailable
  // Dev mode never enforces the token allowance, so local development is
  // never blocked by usage limits.
  const allowed =
    process.env.NODE_ENV !== 'production' ||
    !ent.isOverAllowance(used, allowance) ||
    overrunEnabled
  return {
    allowed,
    used,
    allowance,
    overage,
    overrunEnabled,
    periodEnd: sub.currentPeriodEnd,
  }
}

export async function recordUsage(p: RecordUsageParams): Promise<void> {
  const ent = entitlements()
  const sub = await getOrCreateSubscription(p.userId)
  const features = ent.planFeatures(sub.plan)
  const allowance = await ent.effectiveAllowance(sub)

  // Increment the period totals.
  const newUsed = sub.tokenUsedMonthly + p.promptTokens + p.completionTokens
  const nowOver = ent.isOverAllowance(newUsed, allowance)
  const overrunEnabled = sub.overrunEnabled && features.overrunAvailable

  const update: {
    tokenUsedMonthly: number
    tokenOverageMonthly?: number
    overageAccruedCents?: number
  } = { tokenUsedMonthly: newUsed }

  // If this call pushed the user over the allowance (or they were already
  // over) AND they've opted into overrun billing, accrue the overage.
  if (nowOver && overrunEnabled) {
    const tokensThisCall = p.promptTokens + p.completionTokens
    update.tokenOverageMonthly = sub.tokenOverageMonthly + tokensThisCall
    update.overageAccruedCents = sub.overageAccruedCents + p.costCents
  }

  await db.subscription.update({ where: { id: sub.id }, data: update })

  await db.tokenUsageRecord.create({
    data: {
      userId: p.userId,
      modelId: p.modelId,
      provider: p.provider,
      promptTokens: p.promptTokens,
      completionTokens: p.completionTokens,
      totalTokens: p.promptTokens + p.completionTokens,
      costCents: p.costCents,
      source: p.source,
      refId: p.refId,
    },
  })
}

// ---------------- Public: chat / chatStream ----------------

export async function chat(req: ChatRequest): Promise<ChatResponse> {
  const resolved = await resolveModel(req.userId, req.modelId)
  if (!resolved) {
    throw new Error(
      `Model "${req.modelId}" not found or not configured for this user`,
    )
  }

  if (resolved.adapter === 'cloud-relay') {
    const cloud = cloudAdapter()
    if (!cloud) throw new Error('Cloud relay is not available in this build')
    return cloud.chat(req.userId, {
      modelId: req.modelId,
      messages: req.messages,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      source: req.source,
      refId: req.refId,
    })
  }

  const result = await callAdapter(
    resolved,
    req.messages,
    {
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      tools: req.tools,
      thinking: req.thinking,
    },
    req.userId,
  )

  const costCents = computeCost(resolved.model, result.usage)

  await recordUsage({
    userId: req.userId,
    modelId: req.modelId,
    provider: resolved.model.provider,
    promptTokens: result.usage.promptTokens,
    completionTokens: result.usage.completionTokens,
    costCents,
    source: req.source ?? 'chat',
    refId: req.refId,
  })

  return {
    content: result.content,
    usage: result.usage,
    modelId: req.modelId,
    provider: resolved.model.provider,
    costCents,
  }
}

export async function* chatStream(
  req: ChatRequest,
): AsyncGenerator<StreamEvent> {
  const resolved = await resolveModel(req.userId, req.modelId)
  if (!resolved) {
    throw new Error(
      `Model "${req.modelId}" not found or not configured for this user`,
    )
  }

  if (resolved.adapter === 'cloud-relay') {
    const cloud = cloudAdapter()
    if (!cloud) throw new Error('Cloud relay is not available in this build')
    yield* cloud.chatStream(req.userId, {
      modelId: req.modelId,
      messages: req.messages,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      source: req.source,
      refId: req.refId,
      tools: req.tools,
      thinking: req.thinking,
    })
    return
  }

  const opts = {
    maxTokens: req.maxTokens,
    temperature: req.temperature,
    tools: req.tools,
    thinking: req.thinking,
    signal: req.signal,
  }
  let content = ''
  let usage: ChatUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  }
  let stopReason: StopReason | undefined
  let thinkingBlocks: unknown[] | undefined

  for await (const chunk of streamAdapter(resolved, req.messages, opts, req.userId)) {
    if (chunk.delta) {
      content += chunk.delta
      yield { type: 'delta', content: chunk.delta }
    }
    if (chunk.thinkingDelta) {
      yield { type: 'thinking_delta', content: chunk.thinkingDelta }
    }
    if (chunk.toolCall) {
      yield { type: 'tool_call', toolCall: chunk.toolCall }
    }
    if (chunk.done) {
      if (chunk.done.content) content = chunk.done.content
      usage = chunk.done.usage
      stopReason = chunk.done.stopReason
      thinkingBlocks = chunk.done.thinkingBlocks
    }
  }

  // Fallback: if the adapter didn't yield a `done` with usage, estimate.
  if (usage.totalTokens === 0 && content.length > 0) {
    usage = estimateUsage(req.messages, content)
  } else if (usage.totalTokens === 0) {
    usage = estimateUsage(req.messages, '')
  }

  const costCents = computeCost(resolved.model, usage)

  await recordUsage({
    userId: req.userId,
    modelId: req.modelId,
    provider: resolved.model.provider,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    costCents,
    source: req.source ?? 'chat',
    refId: req.refId,
  })

  yield { type: 'done', usage, stopReason, thinkingBlocks }
}

// ---------------- Public: list available models ----------------

export async function listAvailableModels(userId: string): Promise<{
  models: Array<ModelDefinition & { configured: boolean; custom?: boolean }>
}> {
  const sub = await getOrCreateSubscription(userId)
  const features = entitlements().planFeatures(sub.plan)

  // User's BYOK providers (used only for CustomModel rows now).
  const byokKeys = await db.byokKey.findMany({
    where: { userId, status: 'active' },
    select: { id: true, provider: true },
  })

  // Hosted providers we hold an env key for, or all hosted via cloud relay.
  const hostedProviders = await hostedProvidersForUser(userId)

  // Filter the registry: hosted only if we have the provider key; local if the
  // plan allows.
  const registry = registryAvailableModels(hostedProviders, features.localModelsAllowed)

  const models: Array<ModelDefinition & { configured: boolean; custom?: boolean }> =
    registry.map((m) => ({ ...m, configured: true }))

  // When relaying through cloud, merge the cloud catalog (may include models
  // not in our local registry snapshot).
  const cloud = cloudAdapter()
  if (cloud && hostedProviders.length > 0 && configuredHostedProviders().length === 0) {
    const cloudModels = await cloud.listModels(userId)
    for (const cm of cloudModels) {
      if (cm.tier !== 'hosted' || models.some((m) => m.id === cm.id)) continue
      const reg = getModel(cm.id)
      if (reg) {
        models.push({ ...reg, configured: cm.configured !== false, custom: cm.custom })
      }
    }
  }

  // Append user's CustomModels.
  const customs = await db.customModel.findMany({
    where: { userId, enabled: true },
  })
  for (const c of customs) {
    const tier: ModelDefinition['tier'] =
      c.type === 'online' ? 'byok' : c.type === 'offline' ? 'local' : 'hosted'
    let configured = true
    // For online custom models, check the linked ByokKey status.
    if (c.type === 'online' && c.byokKeyId) {
      const key = byokKeys.find((k) => k.id === c.byokKeyId)
      configured = !!key
    }
    models.push({
      id: c.id,
      name: c.name,
      provider: c.provider as ProviderId,
      tier,
      apiModelId: c.modelId,
      contextWindow: c.contextWindow,
      inputCostCentsPer1M: c.inputCostCentsPer1M,
      outputCostCentsPer1M: c.outputCostCentsPer1M,
      supportsStreaming: true,
      supportsTools: false,
      supportsVision: false,
      description: 'Custom model',
      badge: tier === 'local' ? 'local' : 'byok',
      configured,
      custom: true,
    })
  }

  return { models }
}

// ---------------- Public: BYOK validation ----------------

/**
 * Validate a stored BYOK key by making a minimal test call to the provider.
 * Returns `{ valid, error? }`. Used by the /api/byok/validate route.
 */
export async function validateByokKey(
  byokId: string,
  userId: string,
): Promise<{ valid: boolean; error?: string }> {
  const byok = await db.byokKey.findFirst({
    where: { id: byokId, userId },
  })
  if (!byok) return { valid: false, error: 'Key not found' }

  let apiKey: string
  try {
    apiKey = decrypt(byok.encryptedKey)
  } catch {
    return { valid: false, error: 'Failed to decrypt key' }
  }

  const testMessages: ChatMessage[] = [
    { role: 'user', content: 'ping' },
  ]
  const opts: ChatOpts = { maxTokens: 1 }

  try {
    const provider = byok.provider as ProviderId
    const adapter = pickAdapter(provider)
    if (!adapter) return { valid: false, error: 'Unsupported provider' }
    const baseUrl = byok.baseUrl ?? undefined
    const resolved: ResolvedModel = {
      model: {
        id: byok.id,
        name: byok.label,
        provider,
        tier: 'byok',
        apiModelId: byok.defaultModel || defaultTestModel(provider),
        contextWindow: 0,
        inputCostCentsPer1M: 0,
        outputCostCentsPer1M: 0,
        supportsStreaming: false,
        supportsTools: false,
        supportsVision: false,
        description: '',
      },
      adapter,
      apiKey,
      baseUrl,
    }
    await callAdapter(resolved, testMessages, opts)
    await db.byokKey.update({
      where: { id: byok.id },
      data: { lastStatus: 'valid', lastCheckedAt: new Date() },
    })
    return { valid: true }
  } catch (err) {
    const msg = (err as Error).message || 'Validation failed'
    await db.byokKey.update({
      where: { id: byok.id },
      data: { lastStatus: 'invalid', lastCheckedAt: new Date() },
    })
    return { valid: false, error: msg }
  }
}

function defaultTestModel(provider: ProviderId): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4o-mini'
    case 'anthropic':
      return 'claude-sonnet-4-6'
    case 'google':
      return 'gemini-2.0-flash'
    case 'xai':
      return 'grok-3-mini'
    case 'openrouter':
      return 'openai/gpt-4o-mini'
    case 'mistral':
      return 'mistral-small-latest'
    case 'groq':
      return 'llama-3.1-8b-instant'
    case 'together':
      return 'meta-llama/Llama-3.3-70B-Instruct-Turbo'
    case 'azure_openai':
      return 'gpt-4o-mini'
    case 'ollama':
      return 'llama3.1'
    default:
      return 'gpt-4o-mini'
  }
}

/**
 * Resolve a model preference string to a concrete registry model id.
 * Accepts:
 *   - null / undefined / 'default' → first configured hosted model
 *   - a concrete registry id like 'openai:gpt-4o' → that model (if configured)
 *   - legacy hints 'fast' / 'thinking' → first matching badge among configured models
 */
export function resolveModelPreference(pref?: string | null): string | null {
  const configured = configuredHostedProviders()
  const available = MODEL_REGISTRY.filter(
    (m) => m.tier === 'hosted' && configured.includes(m.provider),
  )

  if (!pref || pref === 'default') {
    const preferredProvider =
      (process.env.LLM_DEFAULT_PROVIDER as ProviderId | undefined)
      ?? (configured.includes('anthropic') ? 'anthropic' : configured[0])
    const preferred = available.find((m) => m.provider === preferredProvider)
    return preferred?.id ?? available[0]?.id ?? null
  }

  const direct = getModel(pref)
  if (direct && direct.tier === 'hosted' && configured.includes(direct.provider)) {
    return direct.id
  }

  if (pref === 'fast') {
    return available.find((m) => m.badge === 'fast')?.id ?? available[0]?.id ?? null
  }
  if (pref === 'thinking') {
    return available.find((m) => m.badge === 'powerful')?.id ?? available[0]?.id ?? null
  }

  return available[0]?.id ?? null
}

/** Like resolveModelPreference but includes cloud-relay when linked. */
export async function resolveModelPreferenceForUser(
  userId: string,
  pref?: string | null,
): Promise<string | null> {
  const configured = await hostedProvidersForUser(userId)
  const available = MODEL_REGISTRY.filter(
    (m) => m.tier === 'hosted' && configured.includes(m.provider),
  )

  if (!pref || pref === 'default') {
    const preferredProvider =
      (process.env.LLM_DEFAULT_PROVIDER as ProviderId | undefined)
      ?? (configured.includes('anthropic') ? 'anthropic' : configured[0])
    const preferred = available.find((m) => m.provider === preferredProvider)
    return preferred?.id ?? available[0]?.id ?? null
  }

  const direct = getModel(pref)
  if (direct && direct.tier === 'hosted' && configured.includes(direct.provider)) {
    return direct.id
  }

  if (pref === 'fast') {
    return available.find((m) => m.badge === 'fast')?.id ?? available[0]?.id ?? null
  }
  if (pref === 'thinking') {
    return available.find((m) => m.badge === 'powerful')?.id ?? available[0]?.id ?? null
  }

  // Concrete registry id when cloud relay makes all hosted providers available.
  if (direct && direct.tier === 'hosted' && configured.length > 0) {
    return direct.id
  }

  return available[0]?.id ?? null
}

async function buildDefaultResolvedForUser(
  userId: string,
  modelHint?: string,
): Promise<ResolvedModel | null> {
  const resolvedId = await resolveModelPreferenceForUser(userId, modelHint)
  if (!resolvedId) return null
  return resolveModel(userId, resolvedId)
}

/** True when a hosted provider key is configured (OpenAI, Anthropic, etc.). */
export function hasHostedLlmProvider(modelHint?: string): boolean {
  const resolvedId = resolveModelPreference(modelHint)
  if (!resolvedId) return false
  const model = getModel(resolvedId)
  if (!model) return false
  return pickHostedEnv(model.provider) !== null
}

/** True when local keys or cloud relay can serve hosted models. */
export async function hasHostedLlmProviderForUser(
  userId: string,
  modelHint?: string,
): Promise<boolean> {
  const resolved = await buildDefaultResolvedForUser(userId, modelHint)
  return resolved !== null
}

/** Non-streaming completion using the first configured hosted provider. */
export async function simpleComplete(opts: {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  model?: string
  json?: boolean
  userId?: string
}): Promise<string> {
  const resolved = opts.userId
    ? await buildDefaultResolvedForUser(opts.userId, opts.model)
    : null
  if (!resolved) {
    const fallback = resolveModelPreference(opts.model)
    if (!fallback) throw new Error(NO_LLM_PROVIDER_ERROR)
    const model = getModel(fallback)
    if (!model) throw new Error(NO_LLM_PROVIDER_ERROR)
    const env = pickHostedEnv(model.provider)
    if (!env) throw new Error(NO_LLM_PROVIDER_ERROR)
    const localResolved: ResolvedModel = {
      model,
      adapter: env.adapter,
      apiKey: env.apiKey,
      baseUrl: env.baseUrl,
    }
    const result = await callAdapter(localResolved, opts.messages, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      json: opts.json,
    })
    return result.content
  }
  const result = await callAdapter(
    resolved,
    opts.messages,
    {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      json: opts.json,
    },
    opts.userId,
  )
  return result.content
}

/** Streaming text deltas using the first configured hosted provider. */
export async function* simpleStream(opts: {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  model?: string
  thinking?: boolean
  thinkingBudgetTokens?: number
}): AsyncGenerator<string> {
  for await (const ev of simpleStreamEvents(opts)) {
    if (ev.type === 'text') yield ev.delta
  }
}

export type LlmStreamEvent =
  | { type: 'thinking'; delta: string }
  | { type: 'text'; delta: string }

/** Stream thinking + text deltas (Anthropic extended thinking when available). */
export async function* simpleStreamEvents(opts: {
  messages: ChatMessage[]
  temperature?: number
  maxTokens?: number
  model?: string
  thinking?: boolean
  thinkingBudgetTokens?: number
  userId?: string
}): AsyncGenerator<LlmStreamEvent> {
  const resolved = opts.userId
    ? await buildDefaultResolvedForUser(opts.userId, opts.model)
    : null
  if (!resolved) {
    const fallback = resolveModelPreference(opts.model)
    if (!fallback) throw new Error(NO_LLM_PROVIDER_ERROR)
    const model = getModel(fallback)
    if (!model) throw new Error(NO_LLM_PROVIDER_ERROR)
    const env = pickHostedEnv(model.provider)
    if (!env) throw new Error(NO_LLM_PROVIDER_ERROR)
    const localResolved: ResolvedModel = {
      model,
      adapter: env.adapter,
      apiKey: env.apiKey,
      baseUrl: env.baseUrl,
    }
    const useThinking = opts.thinking !== false && localResolved.adapter === 'anthropic'
    for await (const chunk of streamAdapter(localResolved, opts.messages, {
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      thinking: useThinking,
      thinkingBudgetTokens: opts.thinkingBudgetTokens,
    })) {
      if (chunk.thinkingDelta) yield { type: 'thinking', delta: chunk.thinkingDelta }
      if (chunk.delta) yield { type: 'text', delta: chunk.delta }
    }
    return
  }
  const useThinking = opts.thinking !== false && resolved.adapter === 'anthropic'
  for await (const chunk of streamAdapter(resolved, opts.messages, {
    temperature: opts.temperature,
    maxTokens: opts.maxTokens,
    thinking: useThinking,
    thinkingBudgetTokens: opts.thinkingBudgetTokens,
  }, opts.userId)) {
    if (chunk.thinkingDelta) yield { type: 'thinking', delta: chunk.thinkingDelta }
    if (chunk.delta) yield { type: 'text', delta: chunk.delta }
  }
}

// Re-export looksLikeKey for the BYOK route.
export { looksLikeKey, MODEL_REGISTRY }
