/**
 * Canonical desktop settings shape — the single JSON blob persisted by the
 * Tauri app in `app_data_dir/desktop-settings.json`.
 *
 * This module is intentionally dependency-free (pure types + defaults + merge)
 * so it can be imported from BOTH the client (settings UI via the Tauri IPC
 * bridge) and the server (the bundled Next.js process, which reads the file
 * directly via `APICAL_DESKTOP_DATA_DIR` — see `desktop-paths.ts`).
 *
 * SECURITY: the file is writable only through the `write_desktop_settings`
 * Tauri command, reachable only from the desktop webview. No web request or
 * the local HTTP server can modify it — that is what makes the remote-access
 * opt-in trustworthy (Phase 4).
 */

/** Filesystem access granted to REMOTE (web/scheduler-originated) invokes. */
export type RemoteFsMode = 'off' | 'read_only' | 'read_write'

/**
 * CLI access for REMOTE invokes — Cursor-style three-way policy instead of
 * the old all-or-nothing boolean:
 *   'off'       — no remote command execution at all (default).
 *   'allowlist' — only the listed programs may run, matched against the
 *                 basename of the first token of the command line. Script
 *                 jobs (arbitrary source via desktop.job.start) have no
 *                 command to match, so they are DENIED in this mode.
 *   'always'    — any command or script job (the old `cli: true`).
 *
 * A fourth mode — 'ask' (per-invoke interactive approval) — is designed but
 * deliberately NOT shipped: it needs a desktop prompt channel with a pending
 * queue, timeout semantics for headless runs, and an audit trail. Roadmap.
 */
export type RemoteCliMode = 'off' | 'allowlist' | 'always'

export interface RemoteCliPolicy {
  mode: RemoteCliMode
  /** Program names for mode='allowlist' (e.g. ["git", "npm"]). Compared
   *  case-insensitively against the basename of the invoked program. */
  allow: string[]
}

export interface RemoteAccessPolicy {
  /** 'off' (default) blocks all remote fs; 'read_only' allows list/read/watch;
   *  'read_write' additionally allows write/move. */
  fs: RemoteFsMode
  /** CLI/script execution policy for remote invokes (default { mode:'off' }). */
  cli: RemoteCliPolicy
  /** Allow remote invokes to make network requests from this machine — can
   *  pivot into the user's LAN, so treat as sensitive (default false). */
  net: boolean
  /** Allow remote invokes to raise native notifications (default true). */
  notify: boolean
}

export type DeploymentMode = 'hybrid' | 'local_only'

export interface DesktopSettings {
  /** Hide to tray on window close instead of quitting (default true). */
  keepRunningInBackground: boolean
  /** Set once the first close-to-tray notification has been shown (Rust). */
  closeToTraySeen: boolean
  /** True once we've applied the default launch-at-login setting. Lets us
   *  enable autostart once on first run without ever re-enabling it after the
   *  user turns it off. */
  autostartConfigured: boolean
  /** Remote-origin access policy. Default-deny (see field defaults). */
  remote: RemoteAccessPolicy
  /** Local mirror of granted folder roots, for defense-in-depth path checks. */
  grantedRoots: string[]
  /** 'hybrid' (cloud-connected) or 'local_only' (fully separated, licensed). */
  deploymentMode: DeploymentMode
  /** Signed enterprise license token enabling local_only mode (or null). */
  license: string | null
}

export const DEFAULT_DESKTOP_SETTINGS: DesktopSettings = {
  keepRunningInBackground: true,
  closeToTraySeen: false,
  autostartConfigured: false,
  remote: { fs: 'off', cli: { mode: 'off', allow: [] }, net: false, notify: true },
  grantedRoots: [],
  deploymentMode: 'hybrid',
  license: null,
}

/** Coerce a stored cli policy — including the legacy boolean — into a valid
 *  RemoteCliPolicy. Legacy `true` meant unrestricted → 'always'; anything
 *  unrecognized fails closed to 'off'. */
function mergeCliPolicy(raw: unknown): RemoteCliPolicy {
  if (raw === true) return { mode: 'always', allow: [] }
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>
    const mode: RemoteCliMode =
      o.mode === 'allowlist' || o.mode === 'always' ? o.mode : 'off'
    const allow = Array.isArray(o.allow)
      ? o.allow.filter((v): v is string => typeof v === 'string' && v.trim().length > 0).map((v) => v.trim())
      : []
    return { mode, allow }
  }
  return { mode: 'off', allow: [] }
}

/** Coerce arbitrary parsed JSON into a complete, valid DesktopSettings. */
export function mergeDesktopSettings(raw: unknown): DesktopSettings {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const rawRemote = (src.remote && typeof src.remote === 'object'
    ? src.remote
    : {}) as Record<string, unknown>

  const fs: RemoteFsMode =
    rawRemote.fs === 'read_only' || rawRemote.fs === 'read_write' ? rawRemote.fs : 'off'

  const grantedRoots = Array.isArray(src.grantedRoots)
    ? src.grantedRoots.filter((v): v is string => typeof v === 'string')
    : []

  const deploymentMode: DeploymentMode =
    src.deploymentMode === 'local_only' ? 'local_only' : 'hybrid'

  return {
    keepRunningInBackground:
      typeof src.keepRunningInBackground === 'boolean' ? src.keepRunningInBackground : true,
    closeToTraySeen: typeof src.closeToTraySeen === 'boolean' ? src.closeToTraySeen : false,
    autostartConfigured:
      typeof src.autostartConfigured === 'boolean' ? src.autostartConfigured : false,
    remote: {
      fs,
      cli: mergeCliPolicy(rawRemote.cli),
      net: rawRemote.net === true,
      notify: rawRemote.notify !== false,
    },
    grantedRoots,
    deploymentMode,
    license: typeof src.license === 'string' ? src.license : null,
  }
}

/**
 * The effective remote capabilities as a flat string array, for mirroring to
 * `DesktopSession.capabilitiesJson` and comparing against a workflow's needs.
 * e.g. ["fs:read_only", "notify"].
 */
export function effectiveRemoteCapabilities(remote: RemoteAccessPolicy): string[] {
  const caps: string[] = []
  if (remote.fs === 'read_only') caps.push('fs:read_only')
  else if (remote.fs === 'read_write') caps.push('fs:read_write')
  if (remote.cli.mode !== 'off') caps.push('cli')
  if (remote.net) caps.push('net')
  if (remote.notify) caps.push('notify')
  return caps
}

/** Which capability a desktop tool requires (for policy checks). */
export type DesktopCapability = 'fs_read' | 'fs_write' | 'cli' | 'net' | 'notify' | 'secrets'

/** Map a `desktop.*` tool name to the capability it needs. */
export function toolCapability(tool: string): DesktopCapability | null {
  switch (tool) {
    case 'desktop.fs.list':
    case 'desktop.fs.read':
    case 'desktop.fs.watch':
      return 'fs_read'
    case 'desktop.fs.write':
    case 'desktop.fs.move':
      return 'fs_write'
    case 'desktop.cli.run':
      return 'cli'
    case 'desktop.net.fetch':
      return 'net'
    case 'desktop.notify':
      return 'notify'
    case 'desktop.secrets.get':
      return 'secrets'
    default:
      return null
  }
}

/** The program a cli invoke wants to run: basename of the first token of
 *  `cmd`. Empty string when there is no matchable command (script jobs). */
function invokedProgram(args: Record<string, unknown> | undefined): string {
  const cmd = typeof args?.cmd === 'string' ? args.cmd.trim() : ''
  if (!cmd) return ''
  const first = cmd.split(/\s+/)[0] ?? ''
  // Basename across both separators so "/usr/bin/git" and "C:\bin\git.exe" match "git".
  const base = first.split(/[/\\]/).pop() ?? ''
  return base.toLowerCase()
}

/**
 * Decide whether a REMOTE-origin invoke of `tool` is allowed under `remote`.
 * `desktop.secrets.get` is NEVER allowed remotely (hard deny). Returns null
 * when allowed, or a `remote_access_denied:<capability>` error string.
 *
 * `args` is consulted only for cli-capability tools in allowlist mode: the
 * invoked program (basename of `cmd`'s first token) must appear in
 * `remote.cli.allow`. Invokes with no matchable command — script jobs — are
 * denied in allowlist mode; they need mode='always'.
 */
export function checkRemoteToolAllowed(
  tool: string,
  remote: RemoteAccessPolicy,
  args?: Record<string, unknown>,
): string | null {
  const cap = toolCapability(tool)
  if (cap === null) {
    // Unknown tool — deny by default.
    return 'remote_access_denied:unknown'
  }
  switch (cap) {
    case 'secrets':
      return 'remote_access_denied:secrets'
    case 'fs_read':
      return remote.fs === 'off' ? 'remote_access_denied:fs' : null
    case 'fs_write':
      return remote.fs === 'read_write' ? null : 'remote_access_denied:fs'
    case 'cli': {
      if (remote.cli.mode === 'always') return null
      if (remote.cli.mode === 'off') return 'remote_access_denied:cli'
      const program = invokedProgram(args)
      if (!program) return 'remote_access_denied:cli_allowlist'
      const allowed = remote.cli.allow.some((a) => {
        const entry = (a.split(/[/\\]/).pop() ?? '').toLowerCase()
        return entry !== '' && entry === program
      })
      return allowed ? null : 'remote_access_denied:cli_allowlist'
    }
    case 'net':
      return remote.net ? null : 'remote_access_denied:net'
    case 'notify':
      return remote.notify ? null : 'remote_access_denied:notify'
    default:
      return 'remote_access_denied:unknown'
  }
}

/**
 * Given the capability strings a desktop reports (from capabilitiesJson) and
 * a set of required capabilities, return the first blocked capability (or null
 * when all are satisfied). Used by the scheduler for skipped_policy decisions.
 */
export function firstBlockedCapability(
  required: DesktopCapability[],
  reported: string[],
): DesktopCapability | null {
  const has = new Set(reported)
  for (const cap of required) {
    if (cap === 'secrets') return 'secrets'
    if (cap === 'fs_read' && !(has.has('fs:read_only') || has.has('fs:read_write')))
      return 'fs_read'
    if (cap === 'fs_write' && !has.has('fs:read_write')) return 'fs_write'
    if (cap === 'cli' && !has.has('cli')) return 'cli'
    if (cap === 'net' && !has.has('net')) return 'net'
    if (cap === 'notify' && !has.has('notify')) return 'notify'
  }
  return null
}
