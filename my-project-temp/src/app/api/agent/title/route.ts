import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { db } from '@/lib/db'
import { generateAgentName, type AgentNameStyle } from '@/lib/apical-server'

interface TitleBody {
  message?: string
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser(req)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = (await req.json().catch(() => ({}))) as TitleBody
    const message = (body.message || '').trim()
    if (!message) {
      return NextResponse.json({ error: 'message is required' }, { status: 400 })
    }

    const [profile, existing] = await Promise.all([
      db.userProfile.findUnique({ where: { userId: user.id } }),
      db.workflow.findMany({
        where: { userId: user.id },
        select: { name: true },
      }),
    ])

    const style = (profile?.agentNameStyle as AgentNameStyle | undefined) ?? 'descriptive'
    const name = generateAgentName(
      style,
      message,
      existing.map((w) => w.name),
    )

    return NextResponse.json({
      name,
      description: message.slice(0, 500),
    })
  } catch (err) {
    console.error('[api/agent/title] POST failed:', err)
    return NextResponse.json({ error: 'Failed to generate title' }, { status: 500 })
  }
}
