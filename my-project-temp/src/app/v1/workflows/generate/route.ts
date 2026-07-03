import { NextResponse } from 'next/server'
import { withAuth } from '@/lib/with-auth'
import { startGenerateJob } from '@/lib/platform/workflow-generate'

// POST /v1/workflows/generate — natural-language spec → designed, validated,
// draft workflow. Async: returns { jobId } immediately; poll
// GET /v1/workflows/generate/{jobId} until status is completed/failed.
export const POST = withAuth(
  async (req, { workspace, user }) => {
    const body = (await req.json().catch(() => null)) as {
      spec?: string
      name?: string
    } | null
    const spec = typeof body?.spec === 'string' ? body.spec.trim() : ''
    if (!spec) {
      return NextResponse.json(
        { error: 'spec (a natural-language description of the automation) is required.' },
        { status: 400 },
      )
    }
    if (spec.length > 5000) {
      return NextResponse.json({ error: 'spec is too long (5000 chars max).' }, { status: 400 })
    }

    const { jobId } = await startGenerateJob({
      workspaceId: workspace.id,
      userId: user?.id ?? null,
      spec,
      name: typeof body?.name === 'string' ? body.name.trim() || null : null,
    })

    return NextResponse.json(
      { jobId, status: 'pending', poll: `/v1/workflows/generate/${jobId}` },
      { status: 202 },
    )
  },
  { scope: 'workflows:write' },
)
