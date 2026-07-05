/**
 * Client-side chat message cache — instant restore on conversation switch,
 * with optional disk sync in the Tauri desktop app.
 */

import type { QueryClient } from '@tanstack/react-query'
import type { AgentMessage } from '@/lib/types'
import type { ChatMessage } from '@/lib/apical'
import { eventsForPersistedMessage } from '@/lib/apical/chat-stream'
import { IS_TAURI } from '@/lib/desktop/tauri-bridge'

const STORAGE_KEY = 'apical:agent-messages-cache:v1'
const MAX_CACHED_AGENTS = 40

type CacheStore = Record<
  string,
  { messages: AgentMessage[]; updatedAt: string }
>

function readStore(): CacheStore {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as CacheStore
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

function writeStore(store: CacheStore): void {
  if (typeof window === 'undefined') return
  try {
    const keys = Object.keys(store)
    if (keys.length > MAX_CACHED_AGENTS) {
      keys
        .sort(
          (a, b) =>
            new Date(store[b]?.updatedAt ?? 0).getTime() -
            new Date(store[a]?.updatedAt ?? 0).getTime(),
        )
        .slice(MAX_CACHED_AGENTS)
        .forEach((k) => delete store[k])
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store))
  } catch {
    /* quota / private mode */
  }
}

/** Read cached API rows for an agent (localStorage). */
export function readAgentMessagesCache(agentId: string): AgentMessage[] | undefined {
  const hit = readStore()[agentId]
  return hit?.messages?.length ? hit.messages : undefined
}

/** Write cached API rows for an agent (localStorage + optional Tauri disk). */
export function writeAgentMessagesCache(agentId: string, messages: AgentMessage[]): void {
  if (!agentId || messages.length === 0) return
  const store = readStore()
  store[agentId] = { messages, updatedAt: new Date().toISOString() }
  writeStore(store)
  void syncAgentMessagesToDisk(agentId, messages)
}

/** Convert live chat rows to API shape for caching. */
export function chatMessagesToAgentRows(messages: ChatMessage[]): AgentMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.role === 'agent')
    .filter((m) => m.content.trim().length > 0 || (m.events?.length ?? 0) > 0)
    .map((m) => ({
      id: m.serverId ?? m.id,
      role: m.role,
      content: m.content,
      events: eventsForPersistedMessage(m),
      createdAt: m.createdAt,
    }))
}

/** Sync the current thread to all cache layers. */
export function syncChatThreadCache(agentId: string, messages: ChatMessage[]): void {
  const rows = chatMessagesToAgentRows(messages)
  if (rows.length === 0) return
  writeAgentMessagesCache(agentId, rows)
}

async function fetchAgentMessages(agentId: string): Promise<AgentMessage[]> {
  const res = await fetch(`/api/agents/${agentId}/messages`)
  if (!res.ok) throw new Error(`messages_${res.status}`)
  return (await res.json()) as AgentMessage[]
}

/** Fetch from API and refresh cache. Falls back to cache on network/DB failure. */
export async function fetchAndCacheAgentMessages(agentId: string): Promise<AgentMessage[]> {
  try {
    const rows = await fetchAgentMessages(agentId)
    writeAgentMessagesCache(agentId, rows)
    return rows
  } catch {
    const cached = readAgentMessagesCache(agentId)
    if (cached) return cached
    if (IS_TAURI) {
      const disk = await loadAgentMessagesFromDisk(agentId)
      if (disk?.length) {
        writeAgentMessagesCache(agentId, disk)
        return disk
      }
    }
    throw new Error('Failed to load messages')
  }
}

/** Warm localStorage from Tauri disk cache (boot). */
export async function hydrateChatCacheFromDisk(agentIds: string[]): Promise<void> {
  if (!IS_TAURI || agentIds.length === 0) return
  await Promise.all(
    agentIds.map(async (agentId) => {
      if (readAgentMessagesCache(agentId)) return
      const disk = await loadAgentMessagesFromDisk(agentId)
      if (disk?.length) writeAgentMessagesCache(agentId, disk)
    }),
  )
}

/** Prefetch recent conversations in the background so they open instantly. */
export async function prefetchRecentAgentMessages(
  queryClient: QueryClient,
  agentIds: string[],
  limit = 10,
): Promise<void> {
  const ids = agentIds.slice(0, limit)
  await hydrateChatCacheFromDisk(ids)
  for (const agentId of ids) {
    const cached = readAgentMessagesCache(agentId)
    if (cached) {
      queryClient.setQueryData(['agent-messages', agentId], cached)
    }
  }
  void Promise.all(
    ids.map((agentId) =>
      queryClient.prefetchQuery({
        queryKey: ['agent-messages', agentId],
        queryFn: () => fetchAndCacheAgentMessages(agentId),
        staleTime: 30_000,
      }),
    ),
  )
}

async function syncAgentMessagesToDisk(agentId: string, messages: AgentMessage[]): Promise<void> {
  if (!IS_TAURI) return
  try {
    await fetch('/api/desktop/local/chat-cache', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, messages }),
    })
  } catch {
    /* offline */
  }
}

async function loadAgentMessagesFromDisk(agentId: string): Promise<AgentMessage[] | null> {
  try {
    const res = await fetch(
      `/api/desktop/local/chat-cache?agentId=${encodeURIComponent(agentId)}`,
    )
    if (!res.ok) return null
    const data = (await res.json()) as { messages?: AgentMessage[] }
    return Array.isArray(data.messages) ? data.messages : null
  } catch {
    return null
  }
}
