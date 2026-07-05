// Apical — desktop side of the device-authorization login.
//
// Runs inside the Tauri webview. Starts a device request against the cloud,
// opens the verification URL in the OS browser, polls until the user
// approves, and stores the resulting DesktopSession token in the OS keychain
// (via the Tauri keychain backend installed at boot).

import { getKeychainBackend } from '@/lib/auth/vault-interface'
import { openUrlInBrowser } from './tauri-bridge'

/** Keychain handle for the cloud device token (`dsk_...`). */
export const DEVICE_TOKEN_HANDLE = 'apical:cloud:device-token'

export interface DeviceFlowResult {
  sessionToken: string
  session: { id: string; label: string }
}

interface StartResponse {
  deviceCode: string
  userCode: string
  verificationUrl: string
  expiresAt: string
  intervalMs: number
}

export interface DeviceFlowCallbacks {
  /** Called once the browser has been opened; show the code in the UI. */
  onCode?: (userCode: string, verificationUrl: string) => void
}

/**
 * Run the full device-authorization login against `cloudUrl`. Resolves with
 * the session token (already persisted to the keychain), or throws on
 * denial/expiry.
 */
export async function linkDesktopToCloud(
  cloudUrl: string,
  meta: { label?: string; platform?: string; arch?: string; appVersion?: string } = {},
  cbs: DeviceFlowCallbacks = {},
): Promise<DeviceFlowResult> {
  const base = cloudUrl.replace(/\/+$/, '')

  const startRes = await fetch(`${base}/api/auth/device/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(meta),
  })
  if (!startRes.ok) throw new Error('Could not reach the Apical cloud.')
  const start = (await startRes.json()) as StartResponse

  cbs.onCode?.(start.userCode, start.verificationUrl)
  await openUrlInBrowser(start.verificationUrl)

  const deadline = new Date(start.expiresAt).getTime()
  const interval = Math.max(1500, start.intervalMs || 3000)

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, interval))

    const pollRes = await fetch(`${base}/api/auth/device/poll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceCode: start.deviceCode }),
    })
    if (!pollRes.ok) throw new Error('Device login failed — restart the flow.')
    const poll = (await pollRes.json()) as {
      status: string
      sessionToken?: string
      session?: { id: string; label: string }
    }

    if (poll.status === 'pending') continue
    if (poll.status === 'approved' && poll.sessionToken) {
      await getKeychainBackend().set(DEVICE_TOKEN_HANDLE, poll.sessionToken)
      // Hand the token to the local bundled server so it can connect the
      // desktop bridge client out to the cloud relay (the Node process cannot
      // read the OS keychain — only the webview can).
      await syncCloudLinkToLocalServer(base, poll.sessionToken)
      return {
        sessionToken: poll.sessionToken,
        session: poll.session ?? { id: '', label: meta.label ?? 'My Desktop' },
      }
    }
    if (poll.status === 'denied') throw new Error('The request was denied in the browser.')
    throw new Error('The code expired — restart the login.')
  }
  throw new Error('The code expired — restart the login.')
}

/**
 * POST the cloud link to the local bundled server so its bridge client can
 * connect out to the relay. Best-effort — hosted mode / missing route is fine.
 */
export async function syncCloudLinkToLocalServer(
  cloudUrl: string,
  sessionToken: string,
): Promise<void> {
  try {
    await fetch('/api/desktop/local/cloud-link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cloudUrl, sessionToken }),
    })
  } catch {
    /* local server not reachable / hosted mode — ignore */
  }
}

/** Read the stored device token from the keychain (null when not linked). */
export async function getStoredDeviceToken(): Promise<string | null> {
  const token = await getKeychainBackend().get(DEVICE_TOKEN_HANDLE)
  return token && token.startsWith('dsk_') ? token : null
}

/**
 * Re-sync the stored token to the local server (call at app boot so the bridge
 * reconnects after a restart). No-op when not linked.
 */
export async function resyncCloudLinkAtBoot(cloudUrl: string): Promise<void> {
  const token = await getStoredDeviceToken()
  if (token) {
    await syncCloudLinkToLocalServer(cloudUrl.replace(/\/+$/, ''), token)
  }
}

/** Forget the stored device token (sign this desktop out of the cloud). */
export async function clearStoredDeviceToken(): Promise<void> {
  await getKeychainBackend().delete(DEVICE_TOKEN_HANDLE)
  // Also tear down the local bridge connection.
  try {
    await fetch('/api/desktop/local/cloud-link', { method: 'DELETE' })
  } catch {
    /* hosted / local server unreachable — ignore */
  }
}
