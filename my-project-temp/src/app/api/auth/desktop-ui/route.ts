/**
 * GET /api/auth/desktop-ui
 *
 * Zero-JavaScript auth page for the Tauri desktop shell. Avoids React/Next
 * client bundles entirely so inputs and buttons work in Safari 15 WebView.
 */
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isDevBypass } from "@/lib/dev-bypass";
import { buildDesktopAuthHtml } from "@/lib/desktop/desktop-auth-html";
import { appendDesktopShellCookie } from "@/lib/desktop/shell-cookie";
import { desktopAppUrl } from "@/lib/desktop/desktop-origin";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const session = await getServerSession(authOptions);

  if (session?.user?.email) {
    const res = NextResponse.redirect(desktopAppUrl("/desktop"));
    appendDesktopShellCookie(res.headers);
    return res;
  }

  const mode = url.searchParams.get("mode") === "signup" ? "signup" : "signin";
  const error = url.searchParams.get("error") ?? undefined;

  const html = buildDesktopAuthHtml({
    mode,
    error,
    isDev: isDevBypass(),
  });

  const headers = new Headers({
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store, no-cache, must-revalidate",
    Pragma: "no-cache",
  });
  appendDesktopShellCookie(headers);

  return new Response(html, { headers });
}
