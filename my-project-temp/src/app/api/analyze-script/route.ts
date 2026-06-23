import { NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import type {
  IntegrationKind,
  ScriptAnalysis,
  WorkflowStep,
} from '@/lib/types'

interface AnalyzeBody {
  script?: string
  language?: 'curl' | 'python' | 'javascript' | 'auto'
}

function stripFences(s: string): string {
  let out = s.trim()
  out = out.replace(/^```(?:json)?\s*/i, '').replace(/```$/i, '').trim()
  const first = out.indexOf('{')
  const last = out.lastIndexOf('}')
  if (first !== -1 && last !== -1 && last > first) {
    out = out.slice(first, last + 1)
  }
  return out
}

function coerceKind(raw: unknown): IntegrationKind {
  if (raw === 'mcp' || raw === 'http' || raw === 'api') return raw
  return 'http'
}

function coerceAuthType(
  raw: unknown,
): 'bearer' | 'apikey_header' | 'basic' | 'none' {
  if (raw === 'bearer' || raw === 'apikey_header' || raw === 'basic' || raw === 'none') {
    return raw
  }
  return 'none'
}

/** Defensive coercion of the LLM-proposed WorkflowStep. */
function coerceProposedStep(raw: unknown): WorkflowStep | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const r = raw as Record<string, unknown>
  const id = typeof r.id === 'string' && r.id ? r.id : 's1'
  const kind = r.kind === 'tool' ? 'tool' : 'tool' // proposed step is always a tool
  const label =
    typeof r.label === 'string' && r.label ? r.label : 'Call API'
  const step: WorkflowStep = { id, kind, label }

  if (typeof r.tool === 'string' && r.tool) step.tool = r.tool
  if (r.inputs && typeof r.inputs === 'object') {
    step.inputs = r.inputs as Record<string, unknown>
  }

  // http field — the whole point of the proposed step.
  if (r.http && typeof r.http === 'object') {
    const h = r.http as Record<string, unknown>
    const method =
      typeof h.method === 'string' &&
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(
        String(h.method).toUpperCase(),
      )
        ? (String(h.method).toUpperCase() as
            | 'GET'
            | 'POST'
            | 'PUT'
            | 'PATCH'
            | 'DELETE')
        : 'GET'
    const url = typeof h.url === 'string' ? h.url : ''
    if (!url) return undefined // can't propose a step without a URL
    const headers =
      h.headers && typeof h.headers === 'object' && !Array.isArray(h.headers)
        ? Object.fromEntries(
            Object.entries(h.headers as Record<string, unknown>)
              .filter(
                ([, v]) => typeof v === 'string' || typeof v === 'number',
              )
              .map(([k, v]) => [k, String(v)]),
          )
        : undefined
    const body = 'body' in h ? h.body : undefined
    const auth =
      h.auth && typeof h.auth === 'object' && !Array.isArray(h.auth)
        ? (() => {
            const a = h.auth as Record<string, unknown>
            const type = coerceAuthType(a.type)
            const out: {
              type: 'bearer' | 'apikey_header' | 'basic' | 'none'
              ref?: string
              headerName?: string
            } = { type }
            if (typeof a.ref === 'string' && a.ref) out.ref = a.ref
            if (typeof a.headerName === 'string' && a.headerName) {
              out.headerName = a.headerName
            }
            return out
          })()
        : undefined
    const description =
      typeof h.description === 'string' && h.description
        ? h.description
        : undefined
    const httpSpec: WorkflowStep['http'] = {
      method,
      url,
      ...(headers ? { headers } : {}),
      ...(body !== undefined ? { body } : {}),
      ...(auth ? { auth } : {}),
      ...(description ? { description } : {}),
    }
    step.http = httpSpec
  }

  if (typeof r.note === 'string' && r.note) step.note = r.note
  return step
}

// POST /api/analyze-script — analyze a script (curl/python/javascript/etc)
// and infer the API it calls. Returns a ScriptAnalysis with a ready-to-use
// proposed WorkflowStep that has an inline http field.
//
// Body: { script: string, language?: 'curl'|'python'|'javascript'|'auto' }
// Returns: ScriptAnalysis
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AnalyzeBody
    const rawScript = (body.script || '').trim()
    if (!rawScript) {
      return NextResponse.json(
        { error: 'script is required' },
        { status: 400 },
      )
    }
    // Truncate so we don't blow the LLM context.
    const truncated = rawScript.length > 4000 ? rawScript.slice(0, 4000) + '\n…(truncated)' : rawScript
    const language = body.language || 'auto'

    const systemPrompt = `You are an API reverse-engineer. Given this script, infer what API it calls. Return ONLY JSON: { language, summary, inferredCalls: [{ method, url, headers?, bodyShape?, authType?, description }], proposedStep: WorkflowStep (a tool step with an http field), proposedIntegration?: { name, kind, description, tools } }. The proposedStep should be a ready-to-use workflow step with a unique id, kind 'tool', a clear label, and an http field built from the inferred call. If the script doesn't call an API, say so in the summary and return empty inferredCalls.

The proposedStep.http shape is:
{ method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE', url: string, headers?: Record<string,string>, body?: any, auth?: { type: 'bearer'|'apikey_header'|'basic'|'none', ref?: string, headerName?: string }, description?: string }

For auth:
- bearer: token in Authorization header (set auth.type='bearer', auth.ref='cred_<service>')
- apikey_header: API key in a custom header (set auth.type='apikey_header', auth.headerName='X-Api-Key', auth.ref='cred_<service>')
- basic: HTTP basic auth (auth.type='basic')
- none: no auth (auth.type='none')

For the proposedIntegration, return { name, kind: 'mcp'|'api'|'http', description, tools: [{id,name,description}] } where the tools match what the script demonstrates. Use a descriptive name based on the URL's host or service.

If you can detect the language (curl/python/javascript/etc), report it in \`language\`. For 'auto' language input, infer from the script syntax. The summary should be plain English — one or two sentences explaining what the script does and what API it calls.`

    const userPrompt = `Detected/inferred language hint: ${language}\n\nScript:\n\`\`\`\n${truncated}\n\`\`\`\n\nAnalyze this script and return ONLY the JSON object.`

    let analysis: ScriptAnalysis
    try {
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        thinking: { type: 'disabled' },
      })
      const text = completion.choices[0]?.message?.content || ''
      const cleaned = stripFences(text)
      const parsed = JSON.parse(cleaned) as {
        language?: unknown
        summary?: unknown
        inferredCalls?: unknown
        proposedStep?: unknown
        proposedIntegration?: unknown
      }

      const lang =
        typeof parsed.language === 'string' && parsed.language
          ? parsed.language
          : language === 'auto'
            ? 'unknown'
            : language
      const summary =
        typeof parsed.summary === 'string' && parsed.summary
          ? parsed.summary
          : 'Could not infer what this script does.'

      const inferredCalls = Array.isArray(parsed.inferredCalls)
        ? parsed.inferredCalls
            .filter(
              (c): c is Record<string, unknown> =>
                !!c && typeof c === 'object',
            )
            .map((c) => {
              const method =
                typeof c.method === 'string' ? c.method.toUpperCase() : 'GET'
              const url = typeof c.url === 'string' ? c.url : ''
              const headers =
                c.headers && typeof c.headers === 'object' && !Array.isArray(c.headers)
                  ? Object.fromEntries(
                      Object.entries(c.headers as Record<string, unknown>)
                        .filter(
                          ([, v]) => typeof v === 'string' || typeof v === 'number',
                        )
                        .map(([k, v]) => [k, String(v)]),
                    )
                  : undefined
              const bodyShape =
                typeof c.bodyShape === 'string' ? c.bodyShape : undefined
              const authType = coerceAuthType(c.authType)
              const description =
                typeof c.description === 'string' ? c.description : ''
              return {
                method,
                url,
                ...(headers ? { headers } : {}),
                ...(bodyShape ? { bodyShape } : {}),
                authType,
                description,
              }
            })
        : []

      const proposedStep = coerceProposedStep(parsed.proposedStep)
      const proposedIntegration =
        parsed.proposedIntegration &&
        typeof parsed.proposedIntegration === 'object'
          ? (() => {
              const pi = parsed.proposedIntegration as Record<string, unknown>
              const name =
                typeof pi.name === 'string' && pi.name ? pi.name : ''
              if (!name) return undefined
              const kind = coerceKind(pi.kind)
              const description =
                typeof pi.description === 'string' ? pi.description : ''
              const tools = Array.isArray(pi.tools)
                ? pi.tools
                    .filter(
                      (t): t is Record<string, unknown> =>
                        !!t && typeof t === 'object',
                    )
                    .slice(0, 6)
                    .map((t, j) => ({
                      id:
                        typeof t.id === 'string' && t.id
                          ? t.id
                          : `tool${j + 1}`,
                      name:
                        typeof t.name === 'string' && t.name
                          ? t.name
                          : `Tool ${j + 1}`,
                      description:
                        typeof t.description === 'string' ? t.description : '',
                    }))
                : []
              return { name, kind, description, tools }
            })()
          : undefined

      analysis = {
        language: lang,
        summary,
        inferredCalls,
        ...(proposedStep ? { proposedStep } : {}),
        ...(proposedIntegration ? { proposedIntegration } : {}),
      }
    } catch (err) {
      console.error('[api/analyze-script] LLM call/parse failed:', err)
      // Honest fallback.
      analysis = {
        language: language === 'auto' ? 'unknown' : language,
        summary:
          'I tried to analyze this script but couldn\'t reach the reasoning engine. Please try again in a moment.',
        inferredCalls: [],
      }
    }

    return NextResponse.json(analysis)
  } catch (err) {
    console.error('[api/analyze-script] failed:', err)
    return NextResponse.json(
      {
        language: 'unknown',
        summary: `Analysis failed: ${err instanceof Error ? err.message : String(err)}`,
        inferredCalls: [],
      } satisfies ScriptAnalysis,
      { status: 500 },
    )
  }
}
