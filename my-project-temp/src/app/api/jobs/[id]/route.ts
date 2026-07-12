import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { assetDownloadUrl } from '@/lib/platform/assets'

// GET /api/jobs/[id] — full job detail incl. result + artifacts.
export const GET = withUser(async (_req, { user, params }) => {
  const job = await db.job.findFirst({ where: { id: params.id, userId: user.id } })
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 })
  const artifactIds: string[] = job.artifactIdsJson ? (JSON.parse(job.artifactIdsJson) as string[]) : []
  const assets = artifactIds.length
    ? await db.userAsset.findMany({ where: { id: { in: artifactIds }, userId: user.id } })
    : []
  return NextResponse.json({
    id: job.id,
    label: job.label,
    backend: job.backend,
    status: job.status,
    progress: job.progress ?? 0,
    progressNote: job.progressNote,
    error: job.error,
    result: job.resultJson ? JSON.parse(job.resultJson) : null,
    artifacts: assets.map((a) => ({ id: a.id, name: a.name, mimeType: a.mimeType, url: assetDownloadUrl(a.id) })),
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
  })
})
