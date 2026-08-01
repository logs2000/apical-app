// GET /api/download — desktop app availability + download links.
//
// The desktop app ships. The release workflow writes download/manifest.json on
// every tag push, and /downloads/:filename serves (or redirects to) the binary.
// This endpoint is the JSON view of the same data — what version is out, which
// platforms have a build, and where to get each one.
//
//   GET /api/download                 → every platform, with links.
//   GET /api/download?action=manifest → same, explicitly.
//   GET /api/download?os=windows      → just that platform.
//   GET /api/download?os=mac&arch=intel
//                                     → the Intel build rather than arm64.
//
// A platform with no build in the manifest reports available:false with a
// reason, rather than a link that 404s at click time.

import { NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Matches download/manifest.json as written by .github/workflows (flat map). */
interface Manifest {
  version: string
  releasedAt: string
  files: Record<string, string>
}

/** The app runs from the repo root in dev and from my-project-temp on Vercel. */
function manifestCandidates(): string[] {
  const cwd = process.cwd()
  return [
    path.join(cwd, 'download', 'manifest.json'),
    path.join(cwd, 'my-project-temp', 'download', 'manifest.json'),
    path.join(cwd, '..', 'download', 'manifest.json'),
  ]
}

async function readManifest(): Promise<Manifest | null> {
  for (const p of manifestCandidates()) {
    if (!existsSync(p)) continue
    try {
      return JSON.parse(await readFile(p, 'utf8')) as Manifest
    } catch {
      // A corrupt manifest shouldn't take the endpoint down.
    }
  }
  return null
}

interface Build {
  os: string
  arch: string
  label: string
  filename: string
  /** Path on this site — redirects to the release asset. */
  url: string
}

const BUILDS: Build[] = [
  {
    os: 'mac',
    arch: 'arm64',
    label: 'macOS (Apple Silicon)',
    filename: 'apical-mac.dmg',
    url: '/downloads/apical-mac.dmg',
  },
  {
    os: 'mac',
    arch: 'x64',
    label: 'macOS (Intel)',
    filename: 'apical-mac-intel.dmg',
    url: '/downloads/apical-mac-intel.dmg',
  },
  {
    os: 'windows',
    arch: 'x64',
    label: 'Windows',
    filename: 'apical-windows.exe',
    url: '/downloads/apical-windows.exe',
  },
  {
    os: 'linux',
    arch: 'x64',
    label: 'Linux',
    filename: 'apical-linux.AppImage',
    url: '/downloads/apical-linux.AppImage',
  },
]

/** Arch aliases the landing page and curl users actually send. */
function normalizeArch(arch: string | null): string | null {
  if (!arch) return null
  const a = arch.toLowerCase()
  if (a === 'arm64' || a === 'aarch64' || a === 'apple-silicon' || a === 'arm') return 'arm64'
  if (a === 'x64' || a === 'x86_64' || a === 'amd64' || a === 'intel') return 'x64'
  return a
}

function isPublished(build: Build, manifest: Manifest | null): boolean {
  // Either bundled into the deploy, or present in the release manifest.
  if (existsSync(path.join(process.cwd(), 'public', 'downloads', build.filename))) return true
  return Boolean(manifest?.files?.[build.filename])
}

function describe(build: Build, manifest: Manifest | null) {
  const available = isPublished(build, manifest)
  return {
    os: build.os,
    arch: build.arch,
    label: build.label,
    filename: build.filename,
    available,
    ...(available
      ? { url: build.url, releaseUrl: manifest?.files?.[build.filename] ?? null }
      : { reason: `No ${build.label} build in release ${manifest?.version ?? '(none)'} yet.` }),
  }
}

const DESKTOP_FEATURES = [
  'Local filesystem, CLI, and network access for your agents',
  'Watch a folder and run an automation on every new file',
  'Read scanned documents, fill PDF forms, and update spreadsheets in place',
  'Native OS notifications and a system tray',
  'Encrypted local vault for credentials',
]

export async function GET(req: Request) {
  const url = new URL(req.url)
  const os = url.searchParams.get('os')
  const arch = normalizeArch(url.searchParams.get('arch'))
  const action = url.searchParams.get('action')

  const manifest = await readManifest()
  const builds = BUILDS.map((b) => describe(b, manifest))
  const anyAvailable = builds.some((b) => b.available)

  const base = {
    status: anyAvailable ? 'available' : 'unavailable',
    version: manifest?.version ?? null,
    releasedAt: manifest?.releasedAt ?? null,
  }

  // --- all platforms ---
  if (action === 'manifest' || !os) {
    return NextResponse.json({
      ...base,
      desktop: { available: anyAvailable, features: DESKTOP_FEATURES },
      builds,
    })
  }

  // --- one platform ---
  const forOs = builds.filter((b) => b.os === os)
  if (forOs.length === 0) {
    return NextResponse.json(
      {
        ...base,
        error: `Unknown os "${os}". Expected one of: ${[...new Set(BUILDS.map((b) => b.os))].join(', ')}.`,
        builds,
      },
      { status: 400 },
    )
  }

  // Default to the arm64 Mac build, matching the landing page's detection.
  const match = arch
    ? forOs.find((b) => b.arch === arch)
    : (forOs.find((b) => b.arch === 'arm64') ?? forOs[0])

  if (!match) {
    return NextResponse.json(
      {
        ...base,
        error: `No ${os} build for arch "${arch}". Available: ${forOs.map((b) => b.arch).join(', ')}.`,
        builds: forOs,
      },
      { status: 404 },
    )
  }

  return NextResponse.json({ ...base, build: match, builds: forOs })
}
