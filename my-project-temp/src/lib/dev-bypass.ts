/** Dev login bypass — on by default in development; set AUTH_BYPASS_DEV=false to disable. */
export function isDevBypass(): boolean {
  if (process.env.AUTH_BYPASS_DEV === 'false') return false
  // Local Tauri runs a production server with dev bypass still enabled.
  if (process.env.DESKTOP_LOCAL === 'true') return true
  return process.env.NODE_ENV === 'development'
}

export const DEV_USER_EMAIL = 'dev@apical.local'
export const DEV_USER_NAME = 'Developer'

/** Tauri prod bundle uses a local file DATABASE_URL — Prisma Postgres is unavailable. */
export function isDesktopLocalWithoutDb(): boolean {
  return (
    process.env.DESKTOP_LOCAL === 'true' &&
    !(process.env.DATABASE_URL ?? '').startsWith('postgres')
  )
}
