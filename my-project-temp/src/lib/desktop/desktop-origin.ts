/** Canonical origin for desktop auth redirects (must match Tauri devUrl host). */
export function desktopAppOrigin(): string {
  const fromEnv = process.env.NEXTAUTH_URL?.replace(/\/$/, "")
  if (fromEnv) return fromEnv
  return "http://127.0.0.1:3000"
}

export function desktopAppUrl(path: string): URL {
  return new URL(path, desktopAppOrigin())
}
