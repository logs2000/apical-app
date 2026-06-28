// Relay LLM calls from the local desktop server to api.apic.al when no
// provider keys are configured locally. Auth: the user's ap_pat_... token.

import { getApicalCloudUrl, getCloudPat } from '@/lib/platform/cloud-pat'

export interface CloudChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface CloudChatUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface CloudChatResponse {
  content: string
  usage: CloudChatUsage
  modelId: string
  provider: string
  costCents: number
}

export interface CloudStreamEvent {
  type: 'delta' | 'done'
  content?: string
  usage?: CloudChatUsage
}

interface CloudChatRequest {
  modelId: string
  messages: CloudChatMessage[]
  maxTokens?: number
  temperature?: number
  source?: string
  refId?: string
}

function authHeaders(pat: string): HeadersInit {
  return {
    Authorization: `Bearer ${pat}`,
    'Content-Type': 'application/json',
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string; message?: string }
    return body.error || body.message || res.statusText
  } catch {
    return res.statusText || `HTTP ${res.status}`
  }
}

export async function cloudListModels(
  userId: string,
): Promise<
  Array<{
    id: string
    name: string
    provider: string
    tier: string
    configured: boolean
    custom?: boolean
  }>
> {
  const pat = await getCloudPat(userId)
  if (!pat) return []

  const res = await fetch(`${getApicalCloudUrl()}/api/llm/models`, {
    headers: authHeaders(pat),
    cache: 'no-store',
  })
  if (!res.ok) {
    console.warn('[cloud-llm] list models failed:', res.status, await readError(res))
    return []
  }

  const data = (await res.json()) as {
    models?: Array<{
      id: string
      name: string
      provider: string
      tier: string
      configured: boolean
      custom?: boolean
    }>
  }
  return data.models ?? []
}

export async function cloudChat(
  userId: string,
  req: CloudChatRequest,
): Promise<CloudChatResponse> {
  const pat = await getCloudPat(userId)
  if (!pat) throw new Error('Apical cloud token not configured')

  const res = await fetch(`${getApicalCloudUrl()}/api/llm/chat`, {
    method: 'POST',
    headers: authHeaders(pat),
    body: JSON.stringify({
      modelId: req.modelId,
      messages: req.messages,
      stream: false,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      source: req.source,
      refId: req.refId,
    }),
  })

  if (!res.ok) {
    throw new Error(await readError(res))
  }

  const data = (await res.json()) as CloudChatResponse
  return data
}

export async function* cloudChatStream(
  userId: string,
  req: CloudChatRequest,
): AsyncGenerator<CloudStreamEvent> {
  const pat = await getCloudPat(userId)
  if (!pat) throw new Error('Apical cloud token not configured')

  const res = await fetch(`${getApicalCloudUrl()}/api/llm/chat`, {
    method: 'POST',
    headers: authHeaders(pat),
    body: JSON.stringify({
      modelId: req.modelId,
      messages: req.messages,
      stream: true,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
      source: req.source,
      refId: req.refId,
    }),
  })

  if (!res.ok) {
    throw new Error(await readError(res))
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('Cloud stream unavailable')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const parts = buffer.split('\n\n')
    buffer = parts.pop() ?? ''

    for (const part of parts) {
      for (const line of part.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const payload = line.slice(6).trim()
        if (!payload) continue
        try {
          const ev = JSON.parse(payload) as {
            type?: string
            content?: string
            usage?: CloudChatUsage
            error?: string
          }
          if (ev.type === 'delta' && typeof ev.content === 'string') {
            yield { type: 'delta', content: ev.content }
          } else if (ev.type === 'done' && ev.usage) {
            yield { type: 'done', usage: ev.usage }
          } else if (ev.type === 'error') {
            throw new Error(ev.error || 'Cloud stream error')
          }
        } catch (err) {
          if (err instanceof SyntaxError) continue
          throw err
        }
      }
    }
  }
}

/** Probe the cloud API with a PAT (used when saving credentials). */
export async function validateCloudPat(pat: string): Promise<{ ok: boolean; error?: string }> {
  if (!pat.trim().startsWith('ap_pat_')) {
    return { ok: false, error: 'Expected an ap_pat_... token from Settings → API tokens on apic.al' }
  }

  try {
    const res = await fetch(`${getApicalCloudUrl()}/api/llm/models`, {
      headers: authHeaders(pat.trim()),
      cache: 'no-store',
    })
    if (res.ok) return { ok: true }
    return { ok: false, error: await readError(res) }
  } catch (err) {
    return { ok: false, error: (err as Error).message || 'Could not reach Apical cloud' }
  }
}
