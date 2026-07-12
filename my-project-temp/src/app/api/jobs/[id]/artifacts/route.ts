import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { saveAsset } from '@/lib/platform/assets'

// POST /api/jobs/[id]/artifacts — the DESKTOP job backend uploads a job's
// output files here over its authenticated session. Authenticated by the
// desktop sessionToken (X-Desktop-Session header), not a user cookie, since
// the caller is the desktop app, not the browser. Multipart: files[].
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const token = req.headers.get('x-desktop-session') || ''
  if (!token) return NextResponse.json({ error: 'missing session token' }, { status: 401 })

  const session = await db.desktopSession.findUnique({
    where: { sessionToken: token },
    select: { id: true, userId: true },
  })
  if (!session) return NextResponse.json({ error: 'invalid session' }, { status: 401 })

  const job = await db.job.findFirst({
    where: { id, userId: session.userId, desktopSessionId: session.id },
    select: { id: true, userId: true, agentId: true, artifactIdsJson: true },
  })
  if (!job) return NextResponse.json({ error: 'job not found for this session' }, { status: 404 })

  const form = await req.formData().catch(() => null)
  if (!form) return NextResponse.json({ error: 'expected multipart form-data' }, { status: 400 })

  const artifactIds: string[] = job.artifactIdsJson ? (JSON.parse(job.artifactIdsJson) as string[]) : []
  for (const value of form.getAll('files')) {
    if (!(value instanceof File)) continue
    const bytes = Buffer.from(await value.arrayBuffer())
    const asset = await saveAsset({
      userId: job.userId,
      agentId: job.agentId ?? null,
      name: value.name || 'artifact',
      bytes,
      mimeType: value.type || 'application/octet-stream',
      source: 'agent',
      meta: { jobId: job.id, backend: 'desktop' },
    })
    artifactIds.push(asset.id)
  }
  await db.job.update({ where: { id: job.id }, data: { artifactIdsJson: JSON.stringify(artifactIds) } })
  return NextResponse.json({ ok: true, artifactCount: artifactIds.length })
}
