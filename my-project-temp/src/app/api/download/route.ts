// GET /api/download — desktop app download endpoint.
//
// The desktop binaries aren't shipped yet (the build pipeline is WIP — see
// download/README.md). Instead of returning a 404 for every request, this
// endpoint gracefully reports the desktop app is "coming soon" and includes
// the CLI install commands so users can get started immediately.
//
//   GET /api/download              → top-level "coming soon" payload.
//   GET /api/download/manifest     → manifest describing each OS/arch
//                                     (availability=false everywhere for now).
//   GET /api/download?os=mac&arch=arm64
//                                  → per-platform "coming soon" payload with
//                                     install commands for that OS.
//   GET /api/download/file?os=...  → alias for the per-platform payload.
//
// When binaries DO get shipped (place them in /download/ with a manifest.json),
// the manifest endpoint will report availability=true and the file endpoint
// will stream the actual binary. Until then: 200 + coming_soon, never 404.

import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DOWNLOAD_DIR = path.join(process.cwd(), 'download')

interface Manifest {
  version: string
  releasedAt: string
  files: Record<string, Record<string, string>>
  fallback: Record<string, string>
}

async function readManifest(): Promise<Manifest | null> {
  const p = path.join(DOWNLOAD_DIR, 'manifest.json')
  if (!existsSync(p)) return null
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Manifest
  } catch {
    return null
  }
}

// CLI install commands per OS — always available even without binaries.
const INSTALL_COMMANDS: Record<string, { label: string; command: string }> = {
  mac: {
    label: 'macOS',
    command: 'curl -fsSL https://apic.al/install.sh | sh',
  },
  windows: {
    label: 'Windows (PowerShell)',
    command: 'irm https://apic.al/install.ps1 | iex',
  },
  linux: {
    label: 'Linux',
    command: 'curl -fsSL https://apic.al/install.sh | sh',
  },
}

const COMING_SOON_MESSAGE =
  'The Apical desktop app is coming soon. You can install the Apical CLI today — it provides the same agent runtime and local tool access.'

const DESKTOP_PREVIEW_FEATURES = [
  'Native macOS / Windows / Linux app with auto-update',
  'Local filesystem, CLI, and network access for your agents',
  'System tray + global hotkey to summon Apical',
  'Encrypted local vault for credentials',
]

function comingSoonResponse(os?: string | null) {
  const targetOs = os && INSTALL_COMMANDS[os] ? os : null
  const installCommands = targetOs
    ? { [targetOs]: INSTALL_COMMANDS[targetOs] }
    : INSTALL_COMMANDS

  return NextResponse.json({
    status: 'coming_soon',
    message: COMING_SOON_MESSAGE,
    desktop: {
      available: false,
      features: DESKTOP_PREVIEW_FEATURES,
      eta: 'soon',
    },
    installCommands,
    ...(targetOs ? { requestedOs: targetOs } : {}),
  })
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const os = url.searchParams.get('os')
  const arch = url.searchParams.get('arch')
  const action = url.searchParams.get('action') ?? 'file'

  const manifest = await readManifest()

  // --- manifest endpoint ---
  // Always 200 — reports availability per os/arch. For now every entry is
  // availability=false because no binaries have been uploaded.
  if (action === 'manifest' || (!os && !arch)) {
    const availability: Record<string, Record<string, boolean>> = {}
    if (manifest?.files) {
      for (const [o, archs] of Object.entries(manifest.files)) {
        availability[o] = {}
        for (const [a, filename] of Object.entries(archs)) {
          availability[o][a] = existsSync(path.join(DOWNLOAD_DIR, filename))
        }
      }
    }
    // Include the "coming soon" notice alongside the manifest so the caller
    // gets a graceful answer even when no manifest.json exists.
    return NextResponse.json({
      status: 'coming_soon',
      message: COMING_SOON_MESSAGE,
      version: manifest?.version ?? null,
      releasedAt: manifest?.releasedAt ?? null,
      availability,
      installCommands: INSTALL_COMMANDS,
    })
  }

  // --- file endpoint ---
  // If a real binary exists for this os/arch, stream it. Otherwise return
  // a graceful "coming soon" 200 (NOT a 404).
  if (!os || !arch) {
    // Missing params — still 200, with all-platforms info.
    return comingSoonResponse(null)
  }

  const filename = manifest?.files?.[os]?.[arch]
  if (filename) {
    const filePath = path.join(DOWNLOAD_DIR, filename)
    if (existsSync(filePath)) {
      const data = await readFile(filePath)
      const ext = path.extname(filename).toLowerCase()
      const contentType =
        ext === '.dmg'
          ? 'application/x-apple-diskimage'
          : ext === '.exe'
            ? 'application/vnd.microsoft.portable-executable'
            : ext === '.appimage'
              ? 'application/vnd.appimage'
              : ext === '.deb'
                ? 'application/vnd.debian.binary-package'
                : ext === '.rpm'
                  ? 'application/x-rpm'
                  : ext === '.zip'
                    ? 'application/zip'
                    : 'application/octet-stream'

      return new NextResponse(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Content-Length': String(data.byteLength),
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }
  }

  // No binary yet — graceful "coming soon" with the CLI install command for
  // the requested OS (so the user can still get started).
  return comingSoonResponse(os)
}
