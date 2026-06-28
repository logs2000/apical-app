/** Cookie set by the desktop shell auth flow so middleware can route without JS. */
export const DESKTOP_SHELL_COOKIE = "apical-shell";
export const DESKTOP_SHELL_VALUE = "desktop";

export function desktopShellCookieHeader(): string {
  return `${DESKTOP_SHELL_COOKIE}=${DESKTOP_SHELL_VALUE}; Path=/; SameSite=Lax; Max-Age=31536000`;
}

export function appendDesktopShellCookie(headers: Headers): void {
  headers.append("Set-Cookie", desktopShellCookieHeader());
}
