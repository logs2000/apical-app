/**
 * GET /api/auth/desktop-ui
 *
 * Zero-JavaScript auth page for the Tauri desktop shell. Avoids React/Next
 * client bundles entirely so inputs and buttons work in Safari 15 WebView.
 */
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-helpers";
import { buildDesktopAuthHtml } from "@/lib/desktop/desktop-auth-html";
import { appendDesktopShellCookie } from "@/lib/desktop/shell-cookie";
import {
  clearSessionCookieHeader,
  sessionCookieName,
} from "@/lib/desktop/session-cookie";
import { desktopAppUrl } from "@/lib/desktop/desktop-origin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const user = await getCurrentUser();

  if (user) {
    const res = NextResponse.redirect(desktopAppUrl("/desktop"));
    appendDesktopShellCookie(res.headers);
    return res;
  }

  const mode = url.searchParams.get("mode") === "signup" ? "signup" : "signin";
  const error = url.searchParams.get("error") ?? undefined;

  const html = buildDesktopAuthHtml({ mode, error });

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  });
  appendDesktopShellCookie(headers);

  // Stale NextAuth cookie with no resolvable DB user causes a redirect loop
  // between here and /desktop — clear it and show the login form.
  const cookieStore = await cookies();
  if (cookieStore.get(sessionCookieName())?.value) {
    headers.append("Set-Cookie", clearSessionCookieHeader());
  }

  return new Response(html, { headers });
}
