// POST /api/byok/validate — validate a stored BYOK key by making a minimal
// test call (1-token chat) to the provider.
//
// Body: { id }
// Returns: { valid, error? }
// Side effects: updates the ByokKey's lastStatus ('valid'|'invalid') + lastCheckedAt.

import { NextResponse } from 'next/server'
import { withUser } from '@/lib/auth-helpers'
import { validateByokKey } from '@/lib/platform/llm-gateway'

interface ValidateBody {
  id: string
}

export const POST = withUser(async (req, { user }) => {
  let body: ValidateBody
  try {
    body = (await req.json()) as ValidateBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const id = (body.id || '').trim()
  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  const result = await validateByokKey(id, user.id)
  if (result.valid) {
    return NextResponse.json({ valid: true })
  }
  return NextResponse.json({ valid: false, error: result.error })
})
