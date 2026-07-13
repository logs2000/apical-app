// Cloud LLM relay seam. The open core has no hosted relay: `cloudAdapter()`
// returns null and every cloud-relay path in the gateway falls back to
// BYOK/local models. The cloud build registers the real relay (cloud-llm.ts,
// authenticated by the user's ap_pat_... token) at server boot via
// cloud-registration.ts.
//
// The imports below are type-only, so the runtime dependency graph stays
// acyclic and the open-core build never pulls in cloud modules.

import type {
  AssistantToolCall,
  ChatUsage,
  GatewayMessage,
  StopReason,
  ToolSpec,
} from '@/lib/platform/llm-gateway'

export interface CloudChatRequest {
  modelId: string
  messages: GatewayMessage[]
  maxTokens?: number
  temperature?: number
  source?: string
  refId?: string
  tools?: ToolSpec[]
  thinking?: boolean
}

export interface CloudChatResult {
  content: string
  usage: ChatUsage
  modelId: string
  provider: string
  costCents: number
}

export interface CloudStreamEvent {
  type: 'delta' | 'thinking_delta' | 'tool_call' | 'done'
  content?: string
  toolCall?: AssistantToolCall
  usage?: ChatUsage
  stopReason?: StopReason
  thinkingBlocks?: unknown[]
}

export interface CloudModelListing {
  id: string
  name: string
  provider: string
  tier: string
  configured: boolean
  custom?: boolean
}

export interface CloudLLMAdapter {
  isAvailable(userId: string): Promise<boolean>
  chat(userId: string, req: CloudChatRequest): Promise<CloudChatResult>
  chatStream(userId: string, req: CloudChatRequest): AsyncGenerator<CloudStreamEvent>
  listModels(userId: string): Promise<CloudModelListing[]>
}

let adapter: CloudLLMAdapter | null = null

export function setCloudAdapter(a: CloudLLMAdapter): void {
  adapter = a
}

export function cloudAdapter(): CloudLLMAdapter | null {
  return adapter
}
