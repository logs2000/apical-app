import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { getCurrentUser } from '@/lib/auth-helpers'
import { marketplaceGate } from '@/lib/marketplace/gate'

// GET /api/marketplace/providers — list public API provider listings.
// Returns active, public providers sorted by total calls (desc).
//
// Query params:
//   - q:        search query (matches name, description, category)
//   - category: filter by category
//
// Auth required (so anonymous traffic can't enumerate). Returns the public
// fields only — never the provider's Stripe account ID or revenue numbers.

interface ProviderPublic {
  id: string
  name: string
  description: string
  apiBaseUrl: string
  apiDocsUrl: string | null
  authType: string
  pricePer1kCalls: number
  revenueSharePct: number
  category: string
  totalCalls: number
  createdAt: string
  // Note: totalRevenueCents + stripeAccountId are NOT exposed publicly.
}

function toPublic(row: {
  id: string
  name: string
  description: string
  apiBaseUrl: string
  apiDocsUrl: string | null
  authType: string
  pricePer1kCalls: number
  revenueSharePct: number
  category: string
  totalCalls: number
  createdAt: Date
}): ProviderPublic {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    apiBaseUrl: row.apiBaseUrl,
    apiDocsUrl: row.apiDocsUrl,
    authType: row.authType,
    pricePer1kCalls: row.pricePer1kCalls,
    revenueSharePct: row.revenueSharePct,
    category: row.category,
    totalCalls: row.totalCalls,
    createdAt: row.createdAt.toISOString(),
  }
}

export async function GET(req: Request) {
  const gate = marketplaceGate()
  if (gate) return gate

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const url = new URL(req.url)
    const q = (url.searchParams.get('q') || '').trim().toLowerCase()
    const category = url.searchParams.get('category') || ''

    const rows = await db.apiProvider.findMany({
      where: {
        isPublic: true,
        status: 'active',
        ...(category ? { category } : {}),
      },
      orderBy: [{ totalCalls: 'desc' }, { createdAt: 'desc' }],
    })

    const filtered = q
      ? rows.filter(
          (r) =>
            r.name.toLowerCase().includes(q) ||
            r.description.toLowerCase().includes(q) ||
            r.category.toLowerCase().includes(q),
        )
      : rows

    return NextResponse.json({
      total: filtered.length,
      providers: filtered.map(toPublic),
    })
  } catch (err) {
    console.error('[api/marketplace/providers] GET failed:', err)
    return NextResponse.json(
      { error: 'Failed to list marketplace providers' },
      { status: 500 },
    )
  }
}

// POST /api/marketplace/providers — create a new provider listing.
//
// Body:
//   {
//     name: string,             // required
//     description: string,      // required
//     apiBaseUrl: string,       // required — the API's base URL
//     apiDocsUrl?: string,
//     authType?: 'api_key' | 'oauth2' | 'bearer' | 'basic' | 'none',  // default 'api_key'
//     apiSchemaJson?: object,   // OpenAPI-like schema for the API
//     pricePer1kCalls?: number, // cents per 1K calls, default 0
//     revenueSharePct?: number, // 0-100, default 70
//     category?: string,        // default 'general'
//     isPublic?: boolean,       // default true
//   }
//
// Creates the provider owned by the current user. Status starts as
// 'pending_review' (an operator must approve before it shows in the public
// marketplace) to prevent abuse. The owner can still see + use their own
// provider while it's pending.

interface CreateBody {
  name?: string
  description?: string
  apiBaseUrl?: string
  apiDocsUrl?: string
  authType?: 'api_key' | 'oauth2' | 'bearer' | 'basic' | 'none'
  apiSchemaJson?: Record<string, unknown>
  pricePer1kCalls?: number
  revenueSharePct?: number
  category?: string
  isPublic?: boolean
}

export async function POST(req: Request) {
  const gate = marketplaceGate()
  if (gate) return gate

  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as CreateBody
    const name = (body.name || '').trim()
    const description = (body.description || '').trim()
    const apiBaseUrl = (body.apiBaseUrl || '').trim()

    if (!name || !description || !apiBaseUrl) {
      return NextResponse.json(
        { error: 'name, description, and apiBaseUrl are required' },
        { status: 400 },
      )
    }

    // Validate URL shape.
    try {
      new URL(apiBaseUrl)
    } catch {
      return NextResponse.json(
        { error: 'apiBaseUrl must be a valid URL' },
        { status: 400 },
      )
    }

    // Clamp numeric fields.
    const pricePer1kCalls = Math.max(0, Math.floor(body.pricePer1kCalls || 0))
    const revenueSharePct = Math.min(
      100,
      Math.max(0, Math.floor(body.revenueSharePct ?? 70)),
    )

    const authType = body.authType || 'api_key'
    const category = (body.category || 'general').trim()

    const created = await db.apiProvider.create({
      data: {
        userId: user.id,
        name,
        description,
        apiBaseUrl,
        apiDocsUrl: body.apiDocsUrl?.trim() || null,
        authType,
        apiSchemaJson: JSON.stringify(body.apiSchemaJson || {}),
        pricePer1kCalls,
        revenueSharePct,
        category,
        status: 'pending_review',
        isPublic: body.isPublic !== false,
        totalCalls: 0,
        totalRevenueCents: 0,
      },
    })

    return NextResponse.json(
      {
        id: created.id,
        name: created.name,
        status: created.status,
        message:
          'Provider listing created. It will appear in the public marketplace after operator review.',
      },
      { status: 201 },
    )
  } catch (err) {
    console.error('[api/marketplace/providers] POST failed:', err)
    return NextResponse.json(
      { error: 'Failed to create provider listing' },
      { status: 500 },
    )
  }
}
