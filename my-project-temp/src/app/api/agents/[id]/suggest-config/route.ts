import { NextResponse } from 'next/server'
import { simpleComplete, resolveModelPreference, configuredHostedProviders } from '@/lib/platform/llm-gateway'
import { MODEL_REGISTRY } from '@/lib/platform/models'
import { db } from '@/lib/db'

interface RouteCtx { params: Promise<{ id: string }> }

// POST /api/agents/[id]/suggest-config
// Looks at the agent's workflow + recent run history and proposes:
//   - schedule (cron + human label) based on the workflow's nature
//   - modelPreference based on complexity (reason step count, outputShape)
//   - confidenceThreshold based on past flagged rates
//   - autoHardenAfter based on observed execution patterns
//
// Returns a partial Workflow patch. The user accepts/edits in the Config tab.

interface Suggestion {
  schedule: string | null
  modelPreference: string | null
  confidenceThreshold: number | null
  autoHardenAfter: number | null
  reasoning: string
}

export async function POST(_req: Request, { params }: RouteCtx) {
  try {
    const { id } = await params
    const wf = await db.workflow.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { startedAt: 'desc' },
          take: 20,
          select: { status: true, itemsProcessed: true, flaggedCount: true, automaticCount: true, durationMs: true },
        },
        patterns: { orderBy: { occurrences: 'desc' }, take: 10 },
      },
    })
    if (!wf) return NextResponse.json({ error: 'Agent not found' }, { status: 404 })

    // Compute some quick stats from the run history.
    const runs = wf.runs
    const runCount = runs.length
    const totalItems = runs.reduce((s, r) => s + r.itemsProcessed, 0)
    const totalFlagged = runs.reduce((s, r) => s + r.flaggedCount, 0)
    const totalAuto = runs.reduce((s, r) => s + r.automaticCount, 0)
    const flagRate = totalItems > 0 ? totalFlagged / totalItems : 0
    const autoRate = totalItems > 0 ? totalAuto / totalItems : 0

    // Parse the workflow steps to understand complexity.
    let steps: Array<{ kind: string; label: string; tool?: string; prompt?: string; hardened?: boolean }> = []
    try {
      const parsed = JSON.parse(wf.stepsJson)
      if (Array.isArray(parsed?.steps)) steps = parsed.steps
    } catch { /* ignore */ }

    const reasonCount = steps.filter((s) => s.kind === 'reason' && !s.hardened).length
    const toolCount = steps.filter((s) => s.kind === 'tool').length
    const gateCount = steps.filter((s) => s.kind === 'gate').length
    const hardenedCount = steps.filter((s) => s.hardened).length
    const patternCount = wf.patterns.length
    const hardenedPatternCount = wf.patterns.filter((p) => p.hardened).length

    // Build a context summary for the LLM.
    const context = `Agent: ${wf.name}${wf.title ? ` (${wf.title})` : ''}
Description: ${wf.description}
Current trigger: ${wf.trigger}${wf.schedule ? ` (${wf.schedule})` : ''}
Current status: ${wf.status}

Workflow: ${steps.length} steps (${toolCount} tool, ${reasonCount} reason, ${gateCount} gate, ${hardenedCount} hardened)
Step labels: ${steps.map((s) => s.label).join(' · ')}

Recent run history (last ${runCount} runs):
  Total items processed: ${totalItems}
  Automatic (no human): ${totalAuto} (${(autoRate * 100).toFixed(1)}%)
  Flagged for review: ${totalFlagged} (${(flagRate * 100).toFixed(1)}%)
  Observed execution patterns: ${patternCount} (${hardenedPatternCount} already hardened)`

    // Available hosted models for the suggestion prompt.
    const configured = configuredHostedProviders()
    const modelOptions = MODEL_REGISTRY.filter(
      (m) => m.tier === 'hosted' && configured.includes(m.provider),
    )
    const modelIdList = modelOptions.map((m) => m.id).join(', ') || '(none configured)'

    // Use the LLM to propose sensible settings.
    let suggestion: Suggestion
    try {
      const text = await simpleComplete({
        messages: [
          {
            role: 'system',
            content: `You propose configuration settings for an AI agent based on its workflow and recent run history. Respond with ONLY JSON (no fences) of shape:
{
  "schedule": "Every weekday at 9am" | null,
  "modelPreference": "<model id>" | null,
  "confidenceThreshold": 0.0-1.0 | null,
  "autoHardenAfter": 0-N | null,
  "reasoning": "2-4 sentences explaining why these settings fit this agent."
}

Available model ids: ${modelIdList}

Rules:
- Schedule: if the agent watches something (scanner, inbox, folder) → daily or hourly. If it generates reports → weekly or monthly. If it's event-driven or one-off → null (manual).
- Model: pick a concrete model id from the list. Use a fast/cheap model (gpt-4o-mini, claude-3-5-haiku, grok-3-mini, gemini-2.0-flash) if there are 0-1 reason steps. Use a powerful model (gpt-4o, claude-3-5-sonnet, grok-4, gemini-1.5-pro) if there are 3+ reason steps. null = inherit (first available).
- Confidence threshold: if flagRate > 20% → raise to 0.85+. If flagRate < 5% → lower to 0.7. Otherwise keep around 0.8. null = inherit.
- Auto-harden: if there are 2+ unhardened patterns AND 5+ runs → suggest 5. If patterns exist but few runs → suggest 10. Otherwise 0 (off).
- Reasoning: explain the schedule, model, and threshold picks in 2-4 sentences.`,
          },
          { role: 'user', content: context },
        ],
        json: true,
      })
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
      const parsed = JSON.parse(cleaned) as Partial<Suggestion>
      const validIds = new Set(modelOptions.map((m) => m.id))
      const rawPref = typeof parsed.modelPreference === 'string' ? parsed.modelPreference.trim() : null
      suggestion = {
        schedule: typeof parsed.schedule === 'string' && parsed.schedule.trim() ? parsed.schedule.trim() : null,
        modelPreference: rawPref && validIds.has(rawPref) ? rawPref : null,
        confidenceThreshold: typeof parsed.confidenceThreshold === 'number'
          ? Math.max(0, Math.min(1, parsed.confidenceThreshold))
          : null,
        autoHardenAfter: typeof parsed.autoHardenAfter === 'number'
          ? Math.max(0, Math.floor(parsed.autoHardenAfter))
          : null,
        reasoning: typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
          ? parsed.reasoning.trim()
          : 'Based on the agent\'s workflow and history.',
      }
    } catch (err) {
      console.error('[api/agents/[id]/suggest-config] LLM failed:', err)
      // Heuristic fallback.
      const suggestsHourly = /scan|inbox|folder|watch|monitor/i.test(wf.description)
      const suggestsWeekly = /report|summary|digest|weekly/i.test(wf.description)
      suggestion = {
        schedule: suggestsHourly ? 'Every hour' : suggestsWeekly ? 'Every Monday at 9am' : 'Every day at 9am',
        modelPreference: resolveModelPreference(
          reasonCount >= 3 ? 'thinking' : reasonCount <= 1 ? 'fast' : 'default',
        ),
        confidenceThreshold: flagRate > 0.2 ? 0.85 : flagRate < 0.05 ? 0.7 : 0.8,
        autoHardenAfter: patternCount >= 2 && runCount >= 5 ? 5 : 0,
        reasoning: `Heuristic suggestion based on ${runCount} runs (${(autoRate * 100).toFixed(0)}% automatic, ${(flagRate * 100).toFixed(0)}% flagged) and ${reasonCount} reason step${reasonCount === 1 ? '' : 's'} in the workflow.`,
      }
    }

    return NextResponse.json(suggestion)
  } catch (err) {
    console.error('[api/agents/[id]/suggest-config] failed:', err)
    return NextResponse.json({ error: 'Failed to suggest config: ' + (err as Error).message }, { status: 500 })
  }
}
