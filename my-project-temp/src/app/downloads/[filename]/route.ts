import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED = new Set([
  'apical-mac.dmg',
  'apical-mac.tar.gz',
  'apical-windows.exe',
  'apical-linux.AppImage',
])

const CONTENT_TYPE: Record<string, string> = {
  'apical-mac.dmg': 'application/x-apple-diskimage',
  'apical-mac.tar.gz': 'application/gzip',
  'apical-windows.exe': 'application/vnd.microsoft.portable-executable',
  'apical-linux.AppImage': 'application/vnd.appimage',
}

interface DownloadManifest {
  version: string
  releasedAt: string
  files: Record<string, string>
}

const ENV_DOWNLOADS: Record<string, string | undefined> = {
  'apical-mac.dmg': process.env.DESKTOP_MAC_URL,
  'apical-mac.tar.gz': process.env.DESKTOP_MAC_URL,
  'apical-windows.exe': process.env.DESKTOP_WINDOWS_URL,
  'apical-linux.AppImage': process.env.DESKTOP_LINUX_URL,
}

function manifestCandidates(): string[] {
  const cwd = process.cwd()
  return [
    path.join(cwd, 'download', 'manifest.json'),
    path.join(cwd, 'my-project-temp', 'download', 'manifest.json'),
  ]
}

async function readManifest(): Promise<DownloadManifest | null> {
  for (const p of manifestCandidates()) {
    if (!existsSync(p)) continue
    try {
      return JSON.parse(await readFile(p, 'utf8')) as DownloadManifest
    } catch {
      return null
    }
  }
  return null
}

function resolveDownloadUrl(filename: string, manifest: DownloadManifest | null): string | null {
  const fromEnv = ENV_DOWNLOADS[filename]
  if (fromEnv) return fromEnv

  const fromManifest = manifest?.files?.[filename]
  if (fromManifest) return fromManifest

  // Legacy tar.gz links fall through to the current DMG release.
  if (filename === 'apical-mac.tar.gz' && manifest?.files?.['apical-mac.dmg']) {
    return manifest.files['apical-mac.dmg']
  }

  return null
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
  const remote = resolveDownloadUrl(filename, manifest)
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
