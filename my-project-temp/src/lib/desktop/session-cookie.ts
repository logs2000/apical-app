/** Session cookies must not use Secure on http://127.0.0.1 (Tauri local server). */
export function useSecureSessionCookies(): boolean {
  return (process.env.NEXTAUTH_URL ?? "").startsWith("https://");
}

export function sessionCookieName(): string {
  return useSecureSessionCookies()
    ? "__Secure-next-auth.session-token"
    : "next-auth.session-token";
}
