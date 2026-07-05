/**
 * LOCAL-ONLY route (bundled desktop server). Bridges the OS-keychain `dsk_`
 * token — readable only from the Tauri webview — to the Node process, which
 * needs it to connect the desktop bridge client out to the cloud relay.
 *
 * Only active when DESKTOP_LOCAL=true; 404 otherwise so it can never be reached
 * on the hosted cloud deployment.
 *
 *   POST   { cloudUrl, sessionToken }  → persist + (re)start the bridge client
 *   DELETE                             → unlink + stop the bridge client
 *   GET                                → current bridge connection status
 */

import { NextRequest, NextResponse } from 'next/server'
import {
  isBundledDesktopServer,
  writeCloudLink,
  deleteCloudLink,
  type CloudLink,
} from '@/lib/desktop/desktop-paths'
import { currentDeploymentMode } from '@/lib/desktop/desktop-policy'
import {
  startBridgeClient,
  stopBridgeClient,
  getBridgeClientStatus,
} from '@/lib/desktop/bridge-client'

function notLocal(): NextResponse {
  return NextResponse.json({ error: 'not_found' }, { status: 404 })
}

export async function POST(req: NextRequest) {
  if (!isBundledDesktopServer()) return notLocal()

  // In local-only mode the bridge must never connect.
  if (currentDeploymentMode() === 'local_only') {
    return NextResponse.json(
      { error: 'local_only_mode', message: 'Bridge disabled in local-only mode.' },
      { status: 409 },
    )
  }

  let body: Partial<CloudLink> = {}
  try {
    body = (await req.json()) as Partial<CloudLink>
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  const cloudUrl = (body.cloudUrl || '').trim().replace(/\/+$/, '')
  const sessionToken = (body.sessionToken || '').trim()
  if (!cloudUrl || !sessionToken) {
    return NextResponse.json(
      { error: 'cloudUrl and sessionToken are required' },
      { status: 400 },
    )
  }

  const link: CloudLink = { cloudUrl, sessionToken }
  writeCloudLink(link)
  await startBridgeClient(link)

  return NextResponse.json({ ok: true, status: getBridgeClientStatus() })
}

export async function DELETE() {
  if (!isBundledDesktopServer()) return notLocal()
  deleteCloudLink()
  await stopBridgeClient()
  return NextResponse.json({ ok: true })
}

export async function GET() {
  if (!isBundledDesktopServer()) return notLocal()
  return NextResponse.json(getBridgeClientStatus())
}
