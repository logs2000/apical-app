import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { parseWorkflowJSON, relativeTime } from '@/lib/apical-server'
import type { RunReport, WorkflowStep, UserProfile } from '@/lib/types'

// GET /api/briefing?workspaceId= — the proactive secretary briefing shown as
// the Assistant's opening chat message. Returns a status, a 2-3 sentence
// LLM-written plain-English summary, needs-attention items (from recent runs
// with flags), recent activity, and scoped stats. Falls back to a templated
// summary if the LLM is unavailable.

// ---------------- Response shape ----------------

interface NeedsAttentionItem {
  id: string
  agentId: string
  agentName: string
  kind: 'flagged_item' | 'approval_needed' | 'error'
  title: string
  detail: string
  action: 'answer' | 'approve' | 'view'
  runId: string
}

interface ActivityItem {
  runId: string
  agentId: string
  agentName: string
  summary: string
  itemsProcessed: number
  automaticCount: number
  flaggedCount: number
  durationMs: number
  startedAt: string
}

interface BriefingStats {
  itemsThisWeek: number
  automaticPct: number
  flaggedOpen: number
  aiCallsSaved: number
  estCostSavedCents: number
}

interface BriefingResponse {
  status: 'all_good' | 'needs_attention' | 'has_errors'
  statusLine: string
  summary: string
  needsAttention: NeedsAttentionItem[]
  activity: ActivityItem[]
  stats: BriefingStats
}

// ---------------- Helpers ----------------

function safeParseReport(raw: string | null): RunReport | null {
  if (!raw) return null
  try {
    const p = JSON.parse(raw) as RunReport
    if (typeof p?.summary === 'string' && Array.isArray(p.items)) return p
    return null
  } catch {
    return null
  }
}

/** Parse workflow steps so we can look up the kind of a flagged stepId. */
function parseSteps(stepsJson: string | null): WorkflowStep[] {
  if (!stepsJson) return []
  return parseWorkflowJSON(stepsJson).steps
}

/** Roughly 10 cents per AI call saved — matches the seeded ratio on Workflow. */
const CENTS_PER_AI_CALL = 10

function fallbackSummary(
  activity: ActivityItem[],
  needsAttention: NeedsAttentionItem[],
): string {
  if (activity.length === 0) {
    return "Your agents haven't run in the last day — once they do, you'll see a morning summary here."
  }
  const items = activity.reduce((s, a) => s + a.itemsProcessed, 0)
  const flagged = needsAttention.length
  // Unique agent names, preserving order.
  const names: string[] = []
  for (const a of activity) {
    if (!names.includes(a.agentName)) names.push(a.agentName)
  }
  let agentPart: string
  if (names.length === 1) agentPart = names[0]
  else if (names.length === 2) agentPart = `${names[0]} and ${names[1]}`
  else agentPart = `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  const itemsPart = `${items} item${items === 1 ? '' : 's'}`
  const reviewPart =
    flagged > 0
      ? ` ${flagged} ${flagged === 1 ? 'thing needs' : 'things need'} your review.`
      : ' Nothing needs your review.'
  return `Recently your agents handled ${itemsPart}. ${agentPart} did the bulk of the work.${reviewPart}`
}

async function generateSummary(
  activity: ActivityItem[],
  needsAttention: NeedsAttentionItem[],
  stats: BriefingStats,
  profile: UserProfile | null,
): Promise<string> {
  const systemPrompt =
    'You are the Apical assistant giving the user a brief, friendly morning update on what their AI agents did. 2-3 sentences. Plain English. Mention specific agents by name and specific numbers. Don\'t list everything — highlight what matters.'

  const activityBlock =
    activity.length > 0
      ? activity
          .map(
            (a) =>
              `- ${a.agentName}: ${a.summary} (${a.itemsProcessed} items, ${a.automaticCount} automatic, ${a.flaggedCount} flagged, started ${relativeTime(a.startedAt)})`,
          )
          .join('\n')
      : '(no agent runs in the last day)'

  const needsBlock =
    needsAttention.length > 0
      ? needsAttention
          .map((n) => `- ${n.title} — ${n.detail}`)
          .join('\n')
      : '(nothing needs review)'

  const profileLine = profile
    ? `User: ${profile.companyName || 'a small team'}${profile.industry ? `, ${profile.industry}` : ''}.`
    : ''

  const userPrompt = `Here's what happened in the last day or so:

ACTIVITY (recent runs, newest first):
${activityBlock}

ITEMS NEEDING ATTENTION:
${needsBlock}

STATS (last 7 days):
- Items handled: ${stats.itemsThisWeek}
- Automatic: ${stats.automaticPct}%
- Flagged/open: ${stats.flaggedOpen}
- AI calls saved: ${stats.aiCallsSaved}
- Estimated cost saved: $${(stats.estCostSavedCents / 100).toFixed(2)}

${profileLine}

Write a 2-3 sentence morning briefing addressed to the user. Friendly, plain English. Mention specific agents by name and specific numbers. Don't list everything — highlight what matters. If items need review, mention how many. Respond with ONLY the briefing text, no preamble, no JSON, no markdown.`

  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      thinking: { type: 'disabled' },
    })
    const text = completion.choices[0]?.message?.content?.trim()
    if (text && text.length > 15) return text
    return fallbackSummary(activity, needsAttention)
  } catch (err) {
    console.error('[api/briefing] LLM summary failed:', err)
    return fallbackSummary(activity, needsAttention)
  }
}

// ---------------- Route handler ----------------

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const url = new URL(req.url)
    const workspaceId = url.searchParams.get('workspaceId') || null

    const now = Date.now()
    // 48h window for activity — generous so a "morning briefing" catches the
    // previous day's runs even if the seed timestamps have drifted slightly
    // past 24h. The spec asked for ~24h; we use 48h for robustness.
    const since = new Date(now - 48 * 60 * 60 * 1000)
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)

    // Always scope to the caller's workflows + (optionally) workspace.
    const workflowOwner: Record<string, unknown> = { userId: user.id }
    if (workspaceId) workflowOwner.workspaceId = workspaceId
    const runWorkflowFilter = { workflow: workflowOwner }

    // Load recent runs (in the window) with their workflow + steps.
    const runs = await db.run.findMany({
      where: {
        startedAt: { gte: since },
        ...runWorkflowFilter,
      },
      take: 20,
      orderBy: { startedAt: 'desc' },
      include: {
        workflow: {
          select: {
            id: true,
            name: true,
            title: true,
            department: true,
            status: true,
            stepsJson: true,
          },
        },
        steps: { orderBy: { order: 'asc' } },
      },
    })

    // ---------------- Activity (max 5, newest first) ----------------
    const activity: ActivityItem[] = runs.slice(0, 5).map((r) => {
      const report = safeParseReport(r.reportJson)
      return {
        runId: r.id,
        agentId: r.workflowId,
        agentName: r.workflow?.name || 'Unknown agent',
        summary:
          report?.summary ||
          `Processed ${r.itemsProcessed} item${r.itemsProcessed === 1 ? '' : 's'}.`,
        itemsProcessed: r.itemsProcessed,
        automaticCount: r.automaticCount,
        flaggedCount: r.flaggedCount,
        durationMs: r.durationMs,
        startedAt: r.startedAt.toISOString(),
      }
    })

    // ---------------- Needs-attention items (cap at 6) ----------------
    const needsAttention: NeedsAttentionItem[] = []
    for (const r of runs) {
      if (needsAttention.length >= 6) break
      const agentName = r.workflow?.name || 'Unknown agent'

      // Error run → one error item.
      if (r.status === 'failed') {
        needsAttention.push({
          id: `${r.id}:error`,
          agentId: r.workflowId,
          agentName,
          kind: 'error',
          title: `${agentName} hit an error`,
          detail: "This run failed and didn't finish.",
          action: 'view',
          runId: r.id,
        })
        continue
      }

      // No flags and not awaiting gate → skip.
      if (r.flaggedCount === 0 && r.status !== 'awaiting_gate') continue

      const report = safeParseReport(r.reportJson)
      const flags = report?.flags || []
      const steps = parseSteps(r.workflow?.stepsJson || null)

      if (flags.length === 0) {
        // Has flaggedCount > 0 but no per-item flag entries in the report —
        // emit a single summary item.
        const isGate = r.status === 'awaiting_gate'
        needsAttention.push({
          id: `${r.id}:summary`,
          agentId: r.workflowId,
          agentName,
          kind: isGate ? 'approval_needed' : 'flagged_item',
          title: isGate
            ? `${agentName} is waiting on your approval`
            : `${agentName} flagged ${r.flaggedCount} item${r.flaggedCount === 1 ? '' : 's'} for review`,
          detail: isGate
            ? 'A gate step is paused, waiting for your sign-off.'
            : `${r.flaggedCount} item${r.flaggedCount === 1 ? '' : 's'} need a closer look.`,
          action: isGate ? 'approve' : 'view',
          runId: r.id,
        })
        continue
      }

      // Emit one item per flag entry. Classify by inspecting the reason text
      // (confidence/unsure → flagged_item/answer; approval/sign-off →
      // approval_needed/approve) and fall back to the step kind if ambiguous.
      for (const f of flags) {
        if (needsAttention.length >= 6) break
        const step = steps.find((s) => s.id === f.stepId)
        const reasonLower = (f.reason || '').toLowerCase()
        const isConfidence =
          /confiden|threshold|unsure|uncertain|no matching|unknown/i.test(reasonLower)
        const isApproval =
          /approv|sign[- ]off|sign off|signoff|requires your|needs your (sign|approval)/i.test(
            reasonLower,
          )
        const isGate = step?.kind === 'gate'

        let kind: NeedsAttentionItem['kind']
        let action: NeedsAttentionItem['action']
        let title: string
        const itemLabel = f.item || 'an item'

        if (isConfidence) {
          // The agent is unsure — the user needs to ANSWER (provide info).
          kind = 'flagged_item'
          action = 'answer'
          title = `${agentName} is unsure about '${itemLabel}'`
        } else if (isApproval || isGate) {
          // The agent is paused at a gate — the user needs to APPROVE.
          kind = 'approval_needed'
          action = 'approve'
          title = `${agentName} needs approval: ${itemLabel}`
        } else {
          // Generic flag — the user can look at it.
          kind = 'flagged_item'
          action = 'view'
          title = `${agentName} flagged '${itemLabel}'`
        }
        needsAttention.push({
          id: `${r.id}:${f.stepId}:${itemLabel}`,
          agentId: r.workflowId,
          agentName,
          kind,
          title,
          detail: f.reason || (step?.gateMessage ?? 'Needs your review.'),
          action,
          runId: r.id,
        })
      }
    }

    // ---------------- Status + statusLine ----------------
    const hasErrors = runs.some((r) => r.status === 'failed')
    const needsAttnCount = needsAttention.length
    const status: BriefingResponse['status'] = hasErrors
      ? 'has_errors'
      : needsAttnCount > 0
        ? 'needs_attention'
        : 'all_good'
    const statusLine: string = hasErrors
      ? 'Some agents hit errors — worth a look.'
      : needsAttnCount > 0
        ? `${needsAttnCount} ${needsAttnCount === 1 ? 'thing needs' : 'things need'} your attention.`
        : "Everything's running smoothly."

    // ---------------- Stats (scoped to the last 7 days) ----------------
    const weekRuns = await db.run.findMany({
      where: {
        startedAt: { gte: weekAgo },
        ...runWorkflowFilter,
      },
      select: {
        itemsProcessed: true,
        automaticCount: true,
        flaggedCount: true,
        aiCallsSaved: true,
      },
    })

    const itemsThisWeek = weekRuns.reduce((s, r) => s + r.itemsProcessed, 0)
    const autoThisWeek = weekRuns.reduce((s, r) => s + r.automaticCount, 0)
    const flaggedOpen = weekRuns.reduce((s, r) => s + r.flaggedCount, 0)
    const aiCallsSaved = weekRuns.reduce((s, r) => s + r.aiCallsSaved, 0)
    const automaticPct =
      itemsThisWeek > 0 ? Math.round((autoThisWeek / itemsThisWeek) * 100) : 0
    // Run rows don't carry a cost-saved field — estimate from AI calls saved
    // at the canonical 10¢/call ratio (matches the seeded Workflow aggregates).
    const estCostSavedCents = aiCallsSaved * CENTS_PER_AI_CALL

    const stats: BriefingStats = {
      itemsThisWeek,
      automaticPct,
      flaggedOpen,
      aiCallsSaved,
      estCostSavedCents,
    }

    // ---------------- Profile (for the LLM summary) ----------------
    const profileRow = await db.userProfile.findUnique({ where: { userId: user.id } })
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

    // ---------------- LLM summary (defensive) ----------------
    const summary = await generateSummary(activity, needsAttention, stats, profile)

    const response: BriefingResponse = {
      status,
      statusLine,
      summary,
      needsAttention,
      activity,
      stats,
    }

    return NextResponse.json(response)
  } catch (err) {
    console.error('[api/briefing] failed:', err)
    return NextResponse.json(
      {
        status: 'all_good' as const,
        statusLine: "Nothing to report right now.",
        summary: "Couldn't pull your briefing this time — give it another try in a moment.",
        needsAttention: [],
        activity: [],
        stats: {
          itemsThisWeek: 0,
          automaticPct: 0,
          flaggedOpen: 0,
          aiCallsSaved: 0,
          estCostSavedCents: 0,
        },
      } satisfies BriefingResponse,
      { status: 200 },
    )
  }
}
