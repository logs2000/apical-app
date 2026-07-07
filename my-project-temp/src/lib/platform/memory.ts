// Long-term memory — durable facts/preferences/corrections about the user and
// their work, injected into the agent's context and auto-extracted from turns
// on Apical's own models (users are never asked for an AI key).

import { db } from '@/lib/db'
import { inHouseComplete } from '@/lib/platform/llm-service'

const MEMORY_KINDS = ['entity', 'preference', 'correction', 'pattern', 'fact'] as const
type MemoryKind = (typeof MEMORY_KINDS)[number]

const MAX_INJECTED = 30
const MAX_NEW_PER_TURN = 5
const MIN_TURN_CHARS = 200

/**
 * The memory block injected into the agent's system context — top entries by
 * confidence × recency. Labeled as possibly-stale so the agent weighs it
 * against fresh observations; corrections are called out as higher-priority.
 */
export async function loadMemoryBlock(userId: string, agentId?: string | null): Promise<string> {
  const entries = await db.memoryEntry.findMany({
    where: { userId, status: 'active', OR: [{ agentId: null }, ...(agentId ? [{ agentId }] : [])] },
    orderBy: [{ confidence: 'desc' }, { updatedAt: 'desc' }],
    take: MAX_INJECTED * 2,
    select: { id: true, kind: true, subject: true, content: true, confidence: true, updatedAt: true },
  })
  if (entries.length === 0) return ''

  // Rank by confidence × recency, keep the top N.
  const now = Date.now()
  const ranked = entries
    .map((e) => ({
      e,
      score: e.confidence * (1 / (1 + (now - +new Date(e.updatedAt)) / (7 * 86_400_000))),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_INJECTED)
    .map((x) => x.e)

  // Touch lastUsedAt for the surfaced entries (best-effort, fire-and-forget).
  void db.memoryEntry.updateMany({ where: { id: { in: ranked.map((e) => e.id) } }, data: { lastUsedAt: new Date() } }).catch(() => {})

  const byKind = (k: MemoryKind) => ranked.filter((e) => e.kind === k)
  const fmt = (label: string, k: MemoryKind) => {
    const list = byKind(k)
    if (list.length === 0) return ''
    return `${label}:\n${list.map((e) => `- ${e.subject ? `[${e.subject}] ` : ''}${e.content}`).join('\n')}\n`
  }
  const block = [
    fmt('Corrections (these OVERRIDE older assumptions)', 'correction'),
    fmt('Preferences', 'preference'),
    fmt('Known entities', 'entity'),
    fmt('Facts', 'fact'),
    fmt('Observed patterns', 'pattern'),
  ]
    .filter(Boolean)
    .join('')
  if (!block) return ''
  return `LONG-TERM MEMORY (may be stale — corrections outrank preferences; verify against fresh observations before acting):\n${block}\n`
}

/** Upsert a memory entry, reinforcing confidence when it already exists. */
export async function saveMemory(params: {
  userId: string
  agentId?: string | null
  kind: string
  content: string
  subject?: string | null
  confidence?: number
  sourceKind?: 'chat' | 'run' | 'manual'
  sourceId?: string | null
}): Promise<void> {
  const kind = (MEMORY_KINDS as readonly string[]).includes(params.kind) ? params.kind : 'fact'
  const subject = params.subject?.slice(0, 200) || null
  const content = params.content.slice(0, 2000)
  if (!content.trim()) return
  const confidence = Math.max(0, Math.min(0.99, params.confidence ?? 0.5))

  const existing = subject
    ? await db.memoryEntry.findUnique({ where: { userId_kind_subject: { userId: params.userId, kind, subject } } })
    : await db.memoryEntry.findFirst({ where: { userId: params.userId, kind, subject: null, content } })

  if (existing) {
    await db.memoryEntry.update({
      where: { id: existing.id },
      data: {
        content,
        confidence: Math.min(0.99, Math.max(existing.confidence, confidence) + 0.05),
        timesReinforced: { increment: 1 },
        status: 'active',
      },
    })
    return
  }
  await db.memoryEntry
    .create({
      data: {
        userId: params.userId,
        agentId: params.agentId ?? null,
        kind,
        subject,
        content,
        confidence,
        sourceKind: params.sourceKind ?? 'chat',
        sourceId: params.sourceId ?? null,
      },
    })
    .catch(() => {
      /* unique race — another extraction wrote it; fine */
    })
}

/**
 * Extract durable memories from a completed turn. Fire-and-forget on Apical's
 * own models — never blocks the user, never asks for a provider key. Skips
 * short turns and caps new entries per turn.
 */
export async function extractMemories(params: {
  userId: string
  agentId?: string | null
  userText: string
  answerText: string
}): Promise<void> {
  const combined = `${params.userText}\n${params.answerText}`
  if (combined.trim().length < MIN_TURN_CHARS) return

  try {
    const res = await inHouseComplete({
      userId: params.userId,
      source: 'workflow',
      maxTokens: 700,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'You extract durable, reusable memories about the USER and their work from a conversation turn — the kind worth remembering across future sessions. ' +
            'Return ONLY a JSON array (no prose) of at most 5 objects: {kind, subject, content, confidence}. ' +
            'kind ∈ entity|preference|correction|pattern|fact. subject is a short stable dedupe key (e.g. "client:smith-llp" or "pref:tone") or null. ' +
            'content is one concise sentence. confidence 0-1. ' +
            'Only extract things that will matter later: stable preferences, corrections the user made, named entities/accounts they work with, recurring patterns. ' +
            'Do NOT extract one-off task details, transient state, or anything already obvious. Return [] if nothing is worth remembering.',
        },
        { role: 'user', content: `USER: ${params.userText.slice(0, 4000)}\n\nASSISTANT: ${params.answerText.slice(0, 4000)}` },
      ],
    })
    let text = res.content.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return
    text = text.slice(start, end + 1)
    const items = JSON.parse(text) as Array<{ kind?: string; subject?: string | null; content?: string; confidence?: number }>
    if (!Array.isArray(items)) return
    for (const item of items.slice(0, MAX_NEW_PER_TURN)) {
      if (!item.content || typeof item.content !== 'string') continue
      await saveMemory({
        userId: params.userId,
        agentId: params.agentId ?? null,
        kind: String(item.kind ?? 'fact'),
        subject: item.subject ?? null,
        content: item.content,
        confidence: typeof item.confidence === 'number' ? item.confidence : 0.5,
        sourceKind: 'chat',
      })
    }
  } catch {
    // Memory extraction is best-effort — never surface an error.
  }
}
