import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { marketplaceGate } from '@/lib/marketplace/gate'

// Routes for /api/marketplace/providers/[id].
//
//   GET    — fetch a single provider by id. Public listings are visible to
//            any authenticated user; private/non-public listings are visible
//            only to the owner.
//   PATCH  — update a listing. Owner only. Allowed fields: name, description,
//            apiBaseUrl, apiDocsUrl, authType, apiSchemaJson, pricePer1kCalls,
//            revenueSharePct, category, isPublic. Status changes (e.g.
//            'pending_review' → 'active') require an operator and are NOT
//            exposed here.
//   DELETE — delist a provider (soft delete: status='delisted', isPublic=false).
//            Owner only. Existing usage stats are preserved.

interface RouteCtx {
  params: Promise<{ id: string }>
}

export async function GET(req: Request, { params }: RouteCtx) {
  const gate = marketplaceGate()
  if (gate) return gate

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const row = await db.apiProvider.findUnique({ where: { id } })
    if (!row) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }

    // Visibility: public + active = anyone. Otherwise owner only.
    const isOwner = row.userId === user.id
    if (!row.isPublic || row.status !== 'active') {
      if (!isOwner) {
        return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
      }
    }

    return NextResponse.json({
      id: row.id,
      name: row.name,
      description: row.description,
      apiBaseUrl: row.apiBaseUrl,
      apiDocsUrl: row.apiDocsUrl,
      authType: row.authType,
      apiSchemaJson: row.apiSchemaJson,
      pricePer1kCalls: row.pricePer1kCalls,
      revenueSharePct: row.revenueSharePct,
      category: row.category,
      status: row.status,
      isPublic: row.isPublic,
      totalCalls: row.totalCalls,
      // Revenue + Stripe ID only visible to owner.
      ...(isOwner
        ? {
            totalRevenueCents: row.totalRevenueCents,
            stripeAccountId: row.stripeAccountId,
            ownerView: true,
          }
        : {}),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/marketplace/providers/[id]] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to fetch provider' },
      { status: 500 },
    )
  }
}

interface PatchBody {
  name?: string
  description?: string
  apiBaseUrl?: string
  apiDocsUrl?: string | null
  authType?: 'api_key' | 'oauth2' | 'bearer' | 'basic' | 'none'
  apiSchemaJson?: Record<string, unknown>
  pricePer1kCalls?: number
  revenueSharePct?: number
  category?: string
  isPublic?: boolean
}

export async function PATCH(req: Request, { params }: RouteCtx) {
  const gate = marketplaceGate()
  if (gate) return gate

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const row = await db.apiProvider.findUnique({ where: { id } })
    if (!row) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }
    if (row.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = (await req.json().catch(() => ({}))) as PatchBody

    // Build the update payload, validating each field.
    const data: Record<string, unknown> = {}
    if (typeof body.name === 'string' && body.name.trim()) {
      data.name = body.name.trim()
    }
    if (typeof body.description === 'string' && body.description.trim()) {
      data.description = body.description.trim()
    }
    if (typeof body.apiBaseUrl === 'string' && body.apiBaseUrl.trim()) {
      try {
        new URL(body.apiBaseUrl.trim())
        data.apiBaseUrl = body.apiBaseUrl.trim()
      } catch {
        return NextResponse.json(
          { error: 'apiBaseUrl must be a valid URL' },
          { status: 400 },
        )
      }
    }
    if (body.apiDocsUrl !== undefined) {
      data.apiDocsUrl =
        typeof body.apiDocsUrl === 'string' && body.apiDocsUrl.trim()
          ? body.apiDocsUrl.trim()
          : null
    }
    if (body.authType) {
      data.authType = body.authType
    }
    if (body.apiSchemaJson !== undefined) {
      data.apiSchemaJson = JSON.stringify(body.apiSchemaJson)
    }
    if (typeof body.pricePer1kCalls === 'number') {
      data.pricePer1kCalls = Math.max(0, Math.floor(body.pricePer1kCalls))
    }
    if (typeof body.revenueSharePct === 'number') {
      data.revenueSharePct = Math.min(
        100,
        Math.max(0, Math.floor(body.revenueSharePct)),
      )
    }
    if (typeof body.category === 'string' && body.category.trim()) {
      data.category = body.category.trim()
    }
    if (typeof body.isPublic === 'boolean') {
      data.isPublic = body.isPublic
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
    }

    const updated = await db.apiProvider.update({
      where: { id },
      data,
    })

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      status: updated.status,
      updatedAt: updated.updatedAt.toISOString(),
    })
  } catch (err) {
    console.error('[api/marketplace/providers/[id]] PATCH failed:', err)
    return NextResponse.json(
      { error: 'Failed to update provider' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: Request, { params }: RouteCtx) {
  const gate = marketplaceGate()
  if (gate) return gate

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const row = await db.apiProvider.findUnique({ where: { id } })
    if (!row) {
      return NextResponse.json({ error: 'Provider not found' }, { status: 404 })
    }
    if (row.userId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Soft delete: delist + hide. Preserve the row for historical usage tracking.
    await db.apiProvider.update({
      where: { id },
      data: { status: 'delisted', isPublic: false },
    })

    return NextResponse.json({ ok: true, id, status: 'delisted' })
  } catch (err) {
    console.error('[api/marketplace/providers/[id]] DELETE failed:', err)
    return NextResponse.json(
      { error: 'Failed to delist provider' },
      { status: 500 },
    )
  }
}
