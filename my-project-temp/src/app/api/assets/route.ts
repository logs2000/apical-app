import { NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/auth-helpers'
import { listUserAssets, saveAsset, saveFileRef, saveFolderRef, toAssetRecord } from '@/lib/platform/assets'
import { checkPathsGranted } from '@/lib/platform/granted-folders'

/**
 * Upload ceiling.
 *
 * Serverless platforms cap the request body well below what a scanned
 * multi-page PDF can reach (Vercel is ~4.5MB), and the platform's own error
 * for that is opaque. Rejecting a little under the cap lets us say what
 * actually happened and what to do instead.
 */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024

function uploadTooLarge(name: string, size: number): string {
  return (
    `"${name}" is ${(size / 1024 / 1024).toFixed(1)}MB — over the ${MAX_UPLOAD_BYTES / 1024 / 1024}MB upload limit. ` +
    'In the desktop app, point the agent at the file path instead (no size limit); ' +
    'on the web, split the PDF or downscale the scan first.'
  )
}

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
      if (bytes.length > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: uploadTooLarge(file.name, bytes.length) }, { status: 413 })
      }
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

  // Desktop file reference (no byte upload) — must live in a granted root so
  // the agent's fs_read of the localPath will actually succeed.
  if (body.type === 'file' && body.localPath) {
    const granted = await checkPathsGranted(user.id, [body.localPath])
    if (!granted.ok) {
      return NextResponse.json({ error: granted.error }, { status: 403 })
    }
    const asset = await saveFileRef({
      userId: user.id,
      name: body.name || pathBasename(body.localPath),
      localPath: body.localPath,
      mimeType: body.mimeType,
      agentId: body.agentId ?? null,
    })
    return NextResponse.json({ asset })
  }

  if (body.content && body.name) {
    const bytes =
      body.encoding === 'base64'
        ? Buffer.from(body.content, 'base64')
        : Buffer.from(body.content, 'utf8')
    if (bytes.length > MAX_UPLOAD_BYTES) {
      return NextResponse.json({ error: uploadTooLarge(body.name, bytes.length) }, { status: 413 })
    }
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
