import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'

interface DataSource {
  label: string
  kind: string
  detail: string
}

// GET /api/profile — return the current user's UserProfile row, creating a
// default one if none exists yet. Scoped to the caller via `userId`.
export async function GET(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    let row = await db.userProfile.findUnique({ where: { userId: user.id } })
    if (!row) {
      row = await db.userProfile.create({
        data: {
          userId: user.id,
          companyName: '',
          industry: '',
          notes: '',
          dataSourcesJson: '[]',
        },
      })
    }
    let dataSources: DataSource[] = []
    try {
      const parsed = JSON.parse(row.dataSourcesJson || '[]')
      if (Array.isArray(parsed)) {
        dataSources = parsed
          .filter(
            (d): d is DataSource =>
              !!d &&
              typeof d === 'object' &&
              typeof (d as { label?: unknown }).label === 'string',
          )
          .map((d) => ({
            label: d.label,
            kind: typeof d.kind === 'string' ? d.kind : 'other',
            detail: typeof d.detail === 'string' ? d.detail : '',
          }))
      }
    } catch {
      dataSources = []
    }
    return NextResponse.json({
      id: row.id,
      companyName: row.companyName,
      industry: row.industry,
      notes: row.notes,
      dataSources,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/profile] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to load profile' },
      { status: 500 },
    )
  }
}

interface PatchBody {
  companyName?: string
  industry?: string
  notes?: string
  dataSources?: DataSource[]
}

// PATCH /api/profile — upsert the caller's profile. `dataSources` is an
// array of { label, kind, detail }.
export async function PATCH(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const body = (await req.json().catch(() => ({}))) as PatchBody

    const data: Record<string, unknown> = {}
    if (typeof body.companyName === 'string') {
      data.companyName = body.companyName
    }
    if (typeof body.industry === 'string') {
      data.industry = body.industry
    }
    if (typeof body.notes === 'string') {
      data.notes = body.notes
    }
    if (Array.isArray(body.dataSources)) {
      const clean = body.dataSources
        .filter(
          (d) => !!d && typeof d.label === 'string' && d.label.trim(),
        )
        .map((d) => ({
          label: d.label.trim(),
          kind: typeof d.kind === 'string' ? d.kind : 'other',
          detail: typeof d.detail === 'string' ? d.detail : '',
        }))
      data.dataSourcesJson = JSON.stringify(clean)
    }
    if (Object.keys(data).length === 0) {
      return NextResponse.json(
        {
          error:
            'No changes provided. Send companyName, industry, notes, or dataSources.',
        },
        { status: 400 },
      )
    }

    // Upsert scoped to the caller's userId (unique constraint).
    const updated = await db.userProfile.upsert({
      where: { userId: user.id },
      update: data,
      create: {
        userId: user.id,
        companyName: typeof body.companyName === 'string' ? body.companyName : '',
        industry: typeof body.industry === 'string' ? body.industry : '',
        notes: typeof body.notes === 'string' ? body.notes : '',
        dataSourcesJson:
          typeof data.dataSourcesJson === 'string'
            ? (data.dataSourcesJson as string)
            : '[]',
      },
    })
    let dataSources: DataSource[] = []
    try {
      const parsed = JSON.parse(updated.dataSourcesJson || '[]')
      if (Array.isArray(parsed)) dataSources = parsed as DataSource[]
    } catch {
      dataSources = []
    }
    return NextResponse.json({
      id: updated.id,
      companyName: updated.companyName,
      industry: updated.industry,
      notes: updated.notes,
      dataSources,
      createdAt: updated.createdAt.toISOString(),
      updatedAt: updated.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/profile] PATCH failed:', err)
    return NextResponse.json(
      { error: 'Failed to update profile' },
      { status: 500 },
    )
  }
}
