// Apical — POST /v1/workflows/generate pipeline.
//
// Natural-language spec → LLM designs a WorkflowJSON v2 document → the SAME
// validate pipeline as POST /v1/workflows (schema + referential + workspace
// integration refs) → workflow created as a draft. Async: the route creates a
// GenerateJob and returns immediately; callers poll the job status.

import { db } from '@/lib/db'
import { serializeWorkflowJSON } from '@/lib/apical-server'
import { chat, resolveModelPreferenceForUser } from '@/lib/platform/llm-gateway'
import { validateWorkflowForWorkspace } from '@/lib/platform/workflow-validate-server'
import { saveWorkflowSteps } from '@/lib/platform/workflow-revisions'
import { integrationVisibleWhere } from '@/lib/integration-scope'
import type { WorkflowJSON } from '@/lib/types'

const MAX_ATTEMPTS = 2

export async function startGenerateJob(opts: {
  workspaceId: string
  userId: string | null
  spec: string
  name?: string | null
}): Promise<{ jobId: string }> {
  const job = await db.generateJob.create({
    data: {
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      spec: opts.spec,
      name: opts.name ?? null,
    },
  })
  // Fire and forget — callers poll GET /v1/workflows/generate/{jobId}.
  void processGenerateJob(job.id).catch(async (err) => {
    console.error('[workflow-generate] job crashed:', err)
    await db.generateJob
      .update({
        where: { id: job.id },
        data: {
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          completedAt: new Date(),
        },
      })
      .catch(() => {})
  })
  return { jobId: job.id }
}

/** Available integrations, summarized for the design prompt. */
async function integrationCatalog(workspaceId: string): Promise<string> {
  const rows = await db.integration.findMany({
    where: { status: 'connected', ...integrationVisibleWhere(workspaceId) },
    select: { id: true, name: true, kind: true, tools: true },
    take: 40,
  })
  if (rows.length === 0) return '(none connected — use code/http steps only)'
  return rows
    .map((r) => {
      let tools: string[] = []
      try {
        const parsed = JSON.parse(r.tools || '[]') as Array<{ id?: string; name?: string }>
        tools = parsed.slice(0, 12).map((t) => t.id || t.name || '?')
      } catch {
        /* unparseable tools — list the integration bare */
      }
      return `- id="${r.id}" name="${r.name}" kind=${r.kind}${tools.length ? ` tools: ${tools.join(', ')}` : ''}`
    })
    .join('\n')
}

function parseDesign(content: string): { name?: string; description?: string; workflow?: unknown } | null {
  const match = content.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as Record<string, unknown>
    if (parsed.workflow && typeof parsed.workflow === 'object') {
      return parsed as { name?: string; description?: string; workflow?: unknown }
    }
    // Model may have emitted the WorkflowJSON directly.
    if (Array.isArray((parsed as { steps?: unknown }).steps)) {
      return { workflow: parsed }
    }
    return null
  } catch {
    return null
  }
}

export async function processGenerateJob(jobId: string): Promise<void> {
  const job = await db.generateJob.findUnique({ where: { id: jobId } })
  if (!job || job.status !== 'pending') return

  await db.generateJob.update({ where: { id: jobId }, data: { status: 'running' } })

  const fail = async (error: string, issues?: unknown) => {
    await db.generateJob.update({
      where: { id: jobId },
      data: {
        status: 'failed',
        error,
        issuesJson: issues ? JSON.stringify(issues) : null,
        completedAt: new Date(),
      },
    })
  }

  if (!job.userId) {
    await fail('No acting user resolvable for this API key — generation needs an LLM billing identity.')
    return
  }
  const modelId = await resolveModelPreferenceForUser(job.userId, undefined)
  if (!modelId) {
    await fail('No LLM model configured for this workspace.')
    return
  }

  const catalog = await integrationCatalog(job.workspaceId)

  const systemPrompt =
    'You design Apical production automations: deterministic WorkflowJSON v2 documents that run WITHOUT an agent. ' +
    'You output ONLY JSON. Steps must be concrete and executable — no placeholders like "YOUR_URL_HERE" unless the spec genuinely leaves them open.'

  let lastIssues: unknown = null
  let lastError = 'generation failed'

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const retryNote =
      attempt > 1 && lastIssues
        ? `\n\nYour previous attempt failed validation with these issues — fix them:\n${JSON.stringify(lastIssues).slice(0, 2000)}`
        : ''

    const prompt = `Design an Apical automation from this spec:

"${job.spec}"

Connected integrations you may reference by exact id (mcp steps: {"mcp":{"integrationId","tool","args"}}; frozen OpenAPI: "integrationId"+"tool"+"inputs"):
${catalog}

Allowed step kinds (WorkflowJSON v2 — schema at /schemas/workflow/v2.json):
- "tool" with "code": {"language":"javascript"|"shell"|"python","source":"..."} — scripts (PREFERRED for transforms)
- "tool" with "http": {"method","url","headers","body","auth":{"ref":"service-name"}} — API calls; secrets via {{cred:service.field}}
- "tool" with "mcp" or "integrationId"+"tool"+"inputs" — connected integrations (ids above ONLY)
- "reason" with "prompt" — an LLM judgment over prior step outputs ({{stepId.field}} refs)
- "gate" — pause for human approval before destructive/irreversible actions

Rules:
1. 2-8 steps, each with a unique "id" (s1, s2, …) and a plain-English "label".
2. Reference prior outputs as {{stepId.field}}; reference credentials as {{cred:service.field}}.
3. Add a "gate" before anything destructive (sending email, deleting, paying).
4. Do NOT invent integration ids — only use ids from the list above, or code/http steps.
5. Set "hardened": true on deterministic tool steps.${retryNote}

Respond with JSON only:
{"name":"...","description":"...","workflow":{"version":2,"steps":[...]}}`

    let content: string
    try {
      const res = await chat({
        userId: job.userId,
        modelId,
        source: 'workflow',
        temperature: 0.2,
        maxTokens: 3000,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
      })
      content = res.content
    } catch (err) {
      lastError = `LLM call failed: ${err instanceof Error ? err.message : String(err)}`
      continue
    }

    const design = parseDesign(content)
    if (!design?.workflow) {
      lastError = 'LLM did not return a parseable workflow document.'
      continue
    }

    const validation = await validateWorkflowForWorkspace(design.workflow, job.workspaceId)
    if (!validation.ok) {
      lastIssues = validation.issues
      lastError = 'Generated workflow failed validation.'
      continue
    }

    const wf = validation.workflow as WorkflowJSON
    const name =
      job.name?.trim() ||
      (typeof design.name === 'string' && design.name.trim()) ||
      job.spec.slice(0, 60)

    const created = await db.workflow.create({
      data: {
        userId: job.userId,
        workspaceId: job.workspaceId,
        name,
        description:
          (typeof design.description === 'string' && design.description) || job.spec.slice(0, 300),
        stepsJson: serializeWorkflowJSON(wf),
        trigger: 'manual',
        status: 'draft',
        origin: 'agent',
      },
    })
    await saveWorkflowSteps(created.id, wf, {
      author: 'agent',
      note: `Generated from spec via POST /v1/workflows/generate (job ${jobId}).`,
    })

    await db.generateJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        workflowId: created.id,
        issuesJson:
          validation.warnings.length > 0 ? JSON.stringify(validation.warnings) : null,
        completedAt: new Date(),
      },
    })
    return
  }

  await fail(lastError, lastIssues)
}
