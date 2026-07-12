/**
 * Desktop remote-access policy enforcement (server-side, bundled desktop only).
 *
 * This is the single authority for whether a REMOTE-origin invoke (arriving
 * over the desktop bridge from the cloud) may touch this machine. It reads the
 * user-owned settings file (writable only via the Tauri IPC command) and
 * default-denies everything the user has not explicitly opted into.
 *
 * Local-origin invokes (the desktop running its own workflows in-process) do
 * NOT go through this module — they are governed by granted roots + allowCli
 * as before.
 *
 * Intentionally free of Prisma / DB access: the packaged desktop's local DB is
 * unreliable, so policy comes only from the on-disk settings file.
 */

import path from 'path'
import os from 'os'
import { readDesktopSettingsFromDisk } from './desktop-paths'
import {
  approvalTierFromCli,
  checkRemoteToolAllowed,
  effectiveRemoteCapabilities,
  toolCapability,
} from './desktop-settings'

export interface RemoteInvokeDecision {
  allowed: boolean
  /** `remote_access_denied:<capability>` when blocked. */
  error?: string
}

/** Expand ~ and normalize to an absolute path. */
function normalizePath(p: string): string {
  const trimmed = (p || '').trim()
  if (!trimmed) return ''
  const expanded = trimmed.startsWith('~')
    ? path.join(os.homedir(), trimmed.slice(1).replace(/^[/\\]/, ''))
    : trimmed
  return path.resolve(expanded)
}

function isInsideRoot(target: string, root: string): boolean {
  const t = normalizePath(target)
  const r = normalizePath(root)
  if (!t || !r) return false
  if (t === r) return true
  const rel = path.relative(r, t)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/** Which args of each fs tool carry filesystem paths. */
const FS_TOOL_PATH_ARGS: Record<string, string[]> = {
  'desktop.fs.list': ['path'],
  'desktop.fs.read': ['path'],
  'desktop.fs.write': ['path'],
  'desktop.fs.move': ['from', 'to'],
  'desktop.fs.watch': ['path'],
}

function fsPathsForTool(tool: string, args: Record<string, unknown>): string[] {
  const keys = FS_TOOL_PATH_ARGS[tool]
  if (!keys) return []
  return keys
    .map((k) => args[k])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
}

/**
 * Evaluate a remote-origin invoke against the current policy. Returns
 * `{ allowed: true }` or a structured denial. This is the chokepoint the
 * bridge-client calls before executing any tool.
 */
export function evaluateRemoteInvoke(
  tool: string,
  args: Record<string, unknown>,
): RemoteInvokeDecision {
  const settings = readDesktopSettingsFromDisk()

  // In local-only mode the bridge should never be running; double-deny.
  if (settings.deploymentMode === 'local_only') {
    return { allowed: false, error: 'remote_access_denied:local_only' }
  }

  // Capability-level check (fs mode / cli policy / net / notify; secrets
  // never). args matter for cli allowlist mode — the invoked program must be
  // on the user's list, and script jobs (no command to match) are denied.
  const capError = checkRemoteToolAllowed(tool, settings.remote, args)
  if (capError) return { allowed: false, error: capError }

  // Defense-in-depth for filesystem paths: re-enforce against the LOCAL mirror
  // of granted roots so tampering with cloud DB rows cannot widen access. Only
  // enforced when the mirror is populated (otherwise fall back to the
  // cloud-side granted-root check that already runs in the executor).
  const cap = toolCapability(tool)
  if ((cap === 'fs_read' || cap === 'fs_write') && settings.grantedRoots.length > 0) {
    const paths = fsPathsForTool(tool, args)
    for (const p of paths) {
      if (!settings.grantedRoots.some((root) => isInsideRoot(p, root))) {
        return { allowed: false, error: 'remote_access_denied:path_not_granted' }
      }
    }
  }

  return { allowed: true }
}

/** The effective remote capabilities to advertise to the cloud on bridge auth. */
export function currentRemoteCapabilities(): string[] {
  const settings = readDesktopSettingsFromDisk()
  if (settings.deploymentMode === 'local_only') return []
  return effectiveRemoteCapabilities(settings.remote)
}

/** Current deployment mode (hybrid vs local_only) from the settings file. */
export function currentDeploymentMode(): 'hybrid' | 'local_only' {
  return readDesktopSettingsFromDisk().deploymentMode
}

/** The destructive-action approval policy for the agent engine, sourced from the
 *  desktop CLI mode. Used when the run touches this machine (desktop-local /
 *  bridge). Hosted runs with no desktop settings default to 'always' (the
 *  engine's 'critical' floor still applies) — callers pass that default. */
export function currentApprovalPolicy(): { approvalTier: 'ask' | 'allowlist' | 'always'; cliAllowlist: string[] } {
  const settings = readDesktopSettingsFromDisk()
  return {
    approvalTier: approvalTierFromCli(settings.remote.cli.mode),
    cliAllowlist: settings.remote.cli.allow,
  }
}
