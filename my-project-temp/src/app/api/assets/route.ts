import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { listUserAssets, saveAsset, saveFolderRef, toAssetRecord } from '@/lib/platform/assets'

// GET /api/assets — list user assets
export async function GET(req: Request) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const agentId = url.searchParams.get('agentId') ?? undefined
  const kind = url.searchParams.get('kind') ?? undefined
  const assets = await listUserAssets(user.id, { agentId, kind })
  return NextResponse.json({ assets })
}

// POST /api/assets — upload file(s) or register folder path
export async function POST(req: Request) {
  const user = await getCurrentUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const contentType = req.headers.get('content-type') || ''

  if (contentType.includes('multipart/form-data')) {
    const form = await req.formData()
    const agentId = (form.get('agentId') as string) || null
    const files = form.getAll('files').filter((f): f is File => f instanceof File)
    if (files.length === 0) {
      return NextResponse.json({ error: 'No files provided' }, { status: 400 })
    }
    const assets: Awaited<ReturnType<typeof saveAsset>>[] = []
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer())
      assets.push(
        await saveAsset({
          userId: user.id,
          agentId,
          name: file.name,
          bytes,
          mimeType: file.type || 'application/octet-stream',
          source: 'upload',
        }),
      )
    }
    return NextResponse.json({ assets })
  }

  const body = (await req.json().catch(() => ({}))) as {
    type?: 'folder' | 'file'
    name?: string
    localPath?: string
    agentId?: string
    content?: string
    mimeType?: string
    kind?: 'image' | 'file' | 'folder' | 'code'
    encoding?: 'utf8' | 'base64'
  }

  if (body.type === 'folder' && body.localPath) {
    const asset = await saveFolderRef({
      userId: user.id,
      name: body.name || pathBasename(body.localPath),
      localPath: body.localPath,
      agentId: body.agentId ?? null,
    })
    return NextResponse.json({ asset })
  }

  if (body.content && body.name) {
    const bytes =
      body.encoding === 'base64'
        ? Buffer.from(body.content, 'base64')
        : Buffer.from(body.content, 'utf8')
    const asset = await saveAsset({
      userId: user.id,
      agentId: body.agentId ?? null,
      name: body.name,
      bytes,
      mimeType: body.mimeType,
      kind: body.kind,
      source: 'upload',
    })
    return NextResponse.json({ asset })
  }

  return NextResponse.json({ error: 'Invalid upload payload' }, { status: 400 })
}

function pathBasename(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}
