// Apical in-house LLM service — platform-provided model access for product
// features that need a completion OUTSIDE the normal agent loop: workflow
// reason steps (draft an email, summarize, classify, extract), research jobs,
// and similar. Users are NEVER asked for an AI provider key — every call runs
// on Apical's own hosted provider connections (or the user's linked cloud
// relay) and is billed to the user's plan credits exactly like agent usage,
// via the gateway's recordUsage (Subscription + TokenUsageRecord), with its
// own `source` tag so workflow LLM spend is separable from chat/agent spend.

import {
  chat,
  checkAllowance,
  resolveModelPreferenceForUser,
  type ChatMessage,
  type ChatUsage,
} from './llm-gateway'

/** Shown when no hosted model is configured. Never tells end users to supply a provider key. */
export const LLM_SERVICE_UNAVAILABLE_ERROR =
  'AI text generation is temporarily unavailable. Please try again later or contact support.'

export const LLM_ALLOWANCE_EXCEEDED_ERROR =
  'Monthly AI usage allowance reached. Upgrade your plan or enable overage billing in Settings to continue.'

export interface InHouseCompleteParams {
  userId: string
  messages: ChatMessage[]
  /** Billing tag — lets workflow LLM spend be reported separately from chat/agent. */
  source?: 'workflow' | 'reason' | 'research'
  /** Usually the runId, for per-run usage attribution. */
  refId?: string
  /** Workflow/model preference hint ("fast", "thinking", or a registry id). */
  modelHint?: string | null
  maxTokens?: number
  temperature?: number
}

export interface InHouseCompleteResult {
  content: string
  usage: ChatUsage
  costCents: number
  modelId: string
  provider: string
}

/**
 * One completion on Apical's own model connections, billed to the user's
 * credits. Throws user-safe errors (no "get an API key" instructions).
 */
export async function inHouseComplete(p: InHouseCompleteParams): Promise<InHouseCompleteResult> {
  if (!p.userId) throw new Error('inHouseComplete requires a userId (usage is billed to the account)')

  const allowance = await checkAllowance(p.userId)
  if (!allowance.allowed) throw new Error(LLM_ALLOWANCE_EXCEEDED_ERROR)

  const modelId = await resolveModelPreferenceForUser(p.userId, p.modelHint ?? undefined)
  if (!modelId) throw new Error(LLM_SERVICE_UNAVAILABLE_ERROR)

  const res = await chat({
    modelId,
    messages: p.messages,
    userId: p.userId,
    source: p.source ?? 'workflow',
    refId: p.refId,
    maxTokens: p.maxTokens,
    temperature: p.temperature,
    thinking: false,
  })
  return {
    content: res.content,
    usage: res.usage,
    costCents: res.costCents,
    modelId: res.modelId,
    provider: res.provider,
  }
}

// ---------------- "Never ask users for AI keys" guards ----------------

// Matches AI model provider names in a credential service slug or label.
// Deliberately does NOT match bare "google" (Sheets/Gmail keys are fine).
const AI_PROVIDER_KEY_PATTERN =
  /\b(openai|anthropic|claude|chatgpt|gpt-?[3-9][a-z0-9.-]*|gemini|google[ _-]?ai|vertex[ _-]?ai|xai|grok|mistral|groq|together[ _-]?ai|openrouter|deepseek|cohere|perplexity|hugging[ _-]?face)\b/i

/** True when a credential request is for an AI model provider key — these must never be asked of users. */
export function isAiProviderKeyRequest(service: string, label?: string): boolean {
  return AI_PROVIDER_KEY_PATTERN.test(service) || (!!label && AI_PROVIDER_KEY_PATTERN.test(label))
}

/** AI provider API hosts — workflow http nodes should use a reason step instead. */
export const AI_PROVIDER_API_HOSTS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.x.ai',
  'api.mistral.ai',
  'api.groq.com',
  'api.together.xyz',
  'openrouter.ai',
  'api.deepseek.com',
  'api.cohere.com',
  'api.perplexity.ai',
]
