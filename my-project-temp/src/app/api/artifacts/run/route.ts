import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { isDevBypass } from '@/lib/dev-bypass'
import { rateLimitByUser } from '@/lib/rate-limit'
import { getAgentTool, type ToolContext } from '@/lib/platform/agent-tools'

interface RunBody {
  language?: 'javascript' | 'python' | 'shell'
  code?: string
  data?: string
  allowCli?: boolean
}

// POST /api/artifacts/run — execute a single script once.
// JavaScript runs in the server-side sandbox; Python/shell require desktop CLI.
export async function POST(req: Request) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rl = rateLimitByUser(user.id, req, 30, 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: 'rate_limited', retryAfter: rl.retryAfter },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const body = (await req.json().catch(() => ({}))) as RunBody
  const language = (body.language || 'javascript').toLowerCase() as RunBody['language']
  const code = (body.code || '').trim()
  if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 })

  const tool = getAgentTool('script_run')
  if (!tool) return NextResponse.json({ error: 'script_run unavailable' }, { status: 500 })

  const ctx: ToolContext = {
    userId: user.id,
    agentId: null,
    allowCli: body.allowCli ?? isDevBypass(),
    maxFetchBytes: 50_000,
    findings: [],
    executionTrace: [],
    usedCredentialIds: [],
    producedAssets: [],
  }

  try {
    const result = await tool.run({ language, code, data: body.data }, ctx)
    return NextResponse.json({
      ok: result.ok,
      output: result.output,
      error: result.error,
      display: result.display,
    })
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 500 })
  }
}
