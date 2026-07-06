import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'

const POLL_MS = 1200
const MAX_STREAM_MS = 5 * 60 * 1000 // reconnecting clients just re-open

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'awaiting_input'])

// GET /api/agent-runs/[id]/stream?afterSeq=N — SSE compatibility proxy for the
// existing chat client: replays persisted AgentRunEvents as `data: <json>`
// frames (each prefixed with its seq via the `id:` SSE field), then polls for
// new ones until the run is terminal or ~5 minutes pass (client re-opens with
// the last seq). Live-typing deltas are relay-only and don't appear here —
// this stream is for catch-up + completion, not keystroke-level streaming.
export const GET = withUser(async (req, { user, params }) => {
  const run = await db.agentRun.findFirst({
    where: { id: params.id, userId: user.id },
    select: { id: true },
  })
  if (!run) return Response.json({ error: 'not found' }, { status: 404 })

  let afterSeq = Number(new URL(req.url).searchParams.get('afterSeq') ?? -1)
  if (!Number.isFinite(afterSeq)) afterSeq = -1

  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // __seq is embedded in the JSON payload (not the SSE id: field) because
      // the client's SSE reader only parses data: lines.
      const send = (seq: number, json: string) => {
        try {
          const payload = JSON.stringify({ ...(JSON.parse(json) as Record<string, unknown>), __seq: seq })
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`))
        } catch {
          // client went away (or malformed row — skip it)
        }
      }
      const startedAt = Date.now()
      try {
        for (;;) {
          const rows = await db.agentRunEvent.findMany({
            where: { agentRunId: run.id, seq: { gt: afterSeq } },
            orderBy: { seq: 'asc' },
            take: 200,
          })
          for (const r of rows) {
            send(r.seq, r.dataJson)
            afterSeq = r.seq
          }
          const current = await db.agentRun.findUnique({
            where: { id: run.id },
            select: { status: true, error: true },
          })
          if (!current) break
          if (TERMINAL.has(current.status)) {
            // Drain any events written between the fetch and the status read.
            const tail = await db.agentRunEvent.findMany({
              where: { agentRunId: run.id, seq: { gt: afterSeq } },
              orderBy: { seq: 'asc' },
              take: 200,
            })
            for (const r of tail) {
              send(r.seq, r.dataJson)
              afterSeq = r.seq
            }
            if (current.status === 'failed' && current.error) {
              send(afterSeq + 1, JSON.stringify({ type: 'error', message: current.error }))
            }
            break
          }
          if (Date.now() - startedAt > MAX_STREAM_MS || req.signal.aborted) break
          await new Promise((r) => setTimeout(r, POLL_MS))
        }
      } finally {
        try {
          controller.close()
        } catch {
          /* already closed */
        }
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  })
})
