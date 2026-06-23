/**
 * Apical landing — OS detection + landing-seen helpers.
 *
 * `apical_seen_landing` in localStorage gates whether a visitor sees the
 * marketing landing page (first visit) or skips straight to the app shell
 * (returning visitor). Set the key from the landing's "Open the web app"
 * CTA; clear it from the app shell's "Back to home" link via
 * `clearLandingSeen()` + a reload.
 */

export type DetectedOS = 'mac' | 'windows' | 'linux' | 'other'

export const LANDING_SEEN_KEY = 'apical_seen_landing'

/**
 * Inspect navigator.userAgent (and a couple of fallbacks) to figure out the
 * visitor's OS. Returns `'other'` on the server or for unrecognized agents.
 *
 * Safe to call during render — it short-circuits when `navigator` is
 * undefined. The landing page also re-runs it inside `useEffect` so the
 * detected value always matches what's in the DOM after hydration.
 */
export function detectOS(): DetectedOS {
  if (typeof navigator === 'undefined') return 'other'
  const ua = (navigator.userAgent || '').toLowerCase()
  const platform = (navigator.platform || '').toLowerCase()
  if (ua.includes('mac') || platform.includes('mac') || ua.includes('darwin')) {
    return 'mac'
  }
  if (ua.includes('win') || platform.includes('win')) {
    return 'windows'
  }
  if (ua.includes('linux') || platform.includes('linux')) {
    return 'linux'
  }
  return 'other'
}

/**
 * The install command shown in the download dialog / copy-to-clipboard button.
 * Honest + functional: we can't ship compiled Tauri binaries from this
 * environment, so the canonical install paths are Homebrew (mac), Winget
 * (Windows), and a curl install script (Linux). All three also have a
 * "build from source" path in the dialog.
 */
export function installCommandFor(os: DetectedOS): string {
  switch (os) {
    case 'mac':
      return 'brew install --cask apical'
    case 'windows':
      return 'winget install apical.apical'
    case 'linux':
      return 'curl -fsSL https://apical.dev/install.sh | sh'
    default:
      return 'curl -fsSL https://apical.dev/install.sh | sh'
  }
}

/**
 * The URL the download button should hit. Points at the /api/download route
 * which streams the binary if it's been uploaded, or returns a helpful 404
 * with the CLI fallback command.
 */
export function downloadUrl(os: DetectedOS, arch?: string): string {
  const a = arch ?? (os === 'mac' ? 'arm64' : 'x86_64')
  return `/api/download?os=${os}&arch=${a}`
}

/** Friendly OS label for buttons + dialog titles. */
export function osLabel(os: DetectedOS): string {
  switch (os) {
    case 'mac':
      return 'macOS'
    case 'windows':
      return 'Windows'
    case 'linux':
      return 'Linux'
    default:
      return 'your platform'
  }
}

/** Label for the primary download CTA, e.g. "Download for macOS". */
export function downloadButtonLabel(os: DetectedOS): string {
  if (os === 'other') return 'Download'
  return `Download for ${osLabel(os)}`
}

/** Mark the landing as seen so the next visit skips straight to the app. */
export function markLandingSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LANDING_SEEN_KEY, '1')
  } catch {
    // localStorage may be disabled (private mode, etc.) — fail silently.
  }
}

/** Remove the landing-seen flag so the next visit shows the landing again. */
export function clearLandingSeen(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(LANDING_SEEN_KEY)
  } catch {
    // fail silently
  }
}

/** Whether the current visitor has already seen the landing. */
export function hasSeenLanding(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(LANDING_SEEN_KEY) === '1'
  } catch {
    return false
  }
}
