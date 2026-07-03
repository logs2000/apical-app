// Apical — desktop device-authorization login (server side).
//
// Flow (RFC 8628-style):
//   1. Desktop calls POST /api/auth/device/start → { deviceCode, userCode,
//      verificationUrl }. It opens the URL in the OS browser and polls.
//   2. The signed-in user approves the code at /desktop/authorize, which
//      creates a DesktopSession bound to their account.
//   3. The poll returns the DesktopSession token (`dsk_...`) exactly once;
//      the desktop stores it in the OS keychain and presents it as
//      `Authorization: Bearer dsk_...` on API calls to the cloud.
//
// The `dsk_` token doubles as an auth credential: `authenticateDesktopToken`
// resolves it to the owning user, and desktop capabilities (CLI/FS tools) are
// derived from it server-side instead of trusting client-declared flags.

import { createHash, randomBytes, randomInt } from 'crypto'
import type { DesktopSession, User } from '@prisma/client'
import { db } from '@/lib/db'
import { mintSessionToken } from './session-dto'

export const DEVICE_CODE_PREFIX = 'dvc_'
export const DESKTOP_TOKEN_PREFIX = 'dsk_'
export const DEVICE_AUTH_TTL_MS = 10 * 60 * 1000 // 10 minutes
export const DEVICE_POLL_INTERVAL_MS = 3_000

export function mintDeviceCode(): string {
  return DEVICE_CODE_PREFIX + randomBytes(32).toString('hex')
}

export function hashDeviceCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

/** Short human code shown in the browser, e.g. "F7KQ-2MXR". Unambiguous alphabet. */
export function mintUserCode(): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const pick = () => alphabet[randomInt(alphabet.length)]
  const part = () => Array.from({ length: 4 }, pick).join('')
  return `${part()}-${part()}`
}

export interface DesktopTokenAuth {
  session: DesktopSession
  user: User
}

/**
 * Authenticate a request carrying a desktop session token
 * (`Authorization: Bearer dsk_...`). Returns null when the header is absent,
 * malformed, or the token doesn't match a session.
 */
export async function authenticateDesktopToken(
  req: Request,
): Promise<DesktopTokenAuth | null> {
  const header = req.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(dsk_[A-Za-z0-9]+)$/)
  if (!match) return null

  const session = await db.desktopSession.findUnique({
    where: { sessionToken: match[1] },
    include: { user: true },
  })
  if (!session) return null

  // Touch lastSeenAt (best-effort, don't block auth on it).
  void db.desktopSession
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {})

  const { user, ...rest } = session
  return { session: rest as DesktopSession, user }
}

export interface DesktopContext {
  /** True when the caller is the desktop app itself. */
  isDesktop: boolean
  /** True when CLI/FS tools may run (locally or via the desktop bridge). */
  allowCli: boolean
}

/**
 * Derive desktop capabilities server-side. Never trusts client-declared
 * flags. Order:
 *   1. DESKTOP_LOCAL=true — this Next server runs inside the Tauri bundle on
 *      the user's machine, so the caller is by definition the desktop.
 *   2. The request authenticated with a `dsk_` desktop token.
 *   3. Hosted web session with an online desktop bridge session — CLI/FS
 *      tools are allowed (they route through the bridge) but the client
 *      itself is a browser.
 */
export async function deriveDesktopContext(
  req: Request,
  userId: string,
): Promise<DesktopContext> {
  if (process.env.DESKTOP_LOCAL === 'true') {
    return { isDesktop: true, allowCli: true }
  }

  const viaToken = await authenticateDesktopToken(req)
  if (viaToken && viaToken.user.id === userId) {
    return { isDesktop: true, allowCli: true }
  }

  const online = await db.desktopSession.findFirst({
    where: { userId, status: 'online' },
    select: { id: true },
  })
  return { isDesktop: false, allowCli: Boolean(online) }
}

/** Mark stale pending requests expired (called opportunistically from routes). */
export async function expireStaleDeviceRequests(): Promise<void> {
  await db.deviceAuthRequest.updateMany({
    where: { status: 'pending', expiresAt: { lt: new Date() } },
    data: { status: 'expired' },
  })
}

/**
 * Approve a pending device request as `user`: create the DesktopSession and
 * bind it to the request. Returns the created session or null if the code is
 * unknown/expired/already handled.
 */
export async function approveDeviceRequest(
  user: User,
  userCode: string,
): Promise<DesktopSession | null> {
  await expireStaleDeviceRequests()
  const reqRow = await db.deviceAuthRequest.findUnique({
    where: { userCode: userCode.trim().toUpperCase() },
  })
  if (!reqRow || reqRow.status !== 'pending') return null

  const session = await db.desktopSession.create({
    data: {
      userId: user.id,
      label: reqRow.label,
      platform: reqRow.platform,
      arch: reqRow.arch,
      appVersion: reqRow.appVersion,
      sessionToken: mintSessionToken(),
      status: 'offline',
      capabilitiesJson: JSON.stringify(['fs', 'cli', 'net', 'notify']),
    },
  })

  await db.deviceAuthRequest.update({
    where: { id: reqRow.id },
    data: { status: 'approved', userId: user.id, desktopSessionId: session.id },
  })
  return session
}
