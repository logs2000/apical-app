import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set([
  'apical-mac.tar.gz',
  'apical-windows.exe',
  'apical-linux.AppImage',
])

const CONTENT_TYPE: Record<string, string> = {
  'apical-mac.tar.gz': 'application/gzip',
  'apical-windows.exe': 'application/vnd.microsoft.portable-executable',
  'apical-linux.AppImage': 'application/vnd.appimage',
}

interface DownloadManifest {
  version: string
  releasedAt: string
  files: Record<string, string>
}

async function readManifest(): Promise<DownloadManifest | null> {
  const p = path.join(process.cwd(), 'download', 'manifest.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8')) as DownloadManifest
  } catch {
    return null
  }
}

// GET /downloads/:filename — serve local public file, redirect to release URL, or 404.
export async function GET(
  _req: Request,
  ctx: { params: Promise<{ filename: string }> },
) {
  const { filename } = await ctx.params
  if (!ALLOWED.has(filename)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const publicPath = path.join(process.cwd(), 'public', 'downloads', filename)
  if (existsSync(publicPath)) {
    const data = await readFile(publicPath)
    return new NextResponse(data, {
      status: 200,
      headers: {
        'Content-Type': CONTENT_TYPE[filename] ?? 'application/octet-stream',
        'Content-Length': String(data.byteLength),
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  }

  const manifest = await readManifest()
  const remote = manifest?.files?.[filename]
  if (remote) {
    return NextResponse.redirect(remote, 302)
  }

  return NextResponse.json(
    {
      error: 'Desktop build not published yet',
      filename,
      hint: 'Check back soon or install via the CLI from the homepage.',
    },
    { status: 404 },
  )
}
