/**
 * GET /api/auth/desktop-dev — dev-only one-click entry for the desktop app.
 */
import { NextResponse } from "next/server";
import { encode } from "next-auth/jwt";
import { getOrCreateDevUser } from "@/lib/auth";
import { isDevBypass, isDesktopLocalWithoutDb, DEV_USER_EMAIL, DEV_USER_NAME } from "@/lib/dev-bypass";
import { appendDesktopShellCookie } from "@/lib/desktop/shell-cookie";
import { desktopAppUrl } from "@/lib/desktop/desktop-origin";
import { sessionCookieName, useSecureSessionCookies } from "@/lib/desktop/session-cookie";

export async function GET(req: Request) {
  if (!isDevBypass()) {
    return NextResponse.redirect(desktopAppUrl("/api/auth/desktop-ui?error=Dev+bypass+unavailable"));
  }

  try {
    const devUser = isDesktopLocalWithoutDb()
      ? { id: "desktop-local-dev", email: DEV_USER_EMAIL, name: DEV_USER_NAME }
      : await getOrCreateDevUser();
    const secret = process.env.NEXTAUTH_SECRET;
    if (!secret) throw new Error("NEXTAUTH_SECRET is not configured");

    const token = await encode({
      token: {
        sub: devUser.id,
        email: devUser.email,
        name: devUser.name ?? "Developer",
        userId: devUser.id,
      },
      secret,
    });

    const res = NextResponse.redirect(desktopAppUrl("/desktop"));
    const secure = useSecureSessionCookies();
    res.cookies.set(sessionCookieName(), token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
      maxAge: 30 * 24 * 60 * 60,
    });
    appendDesktopShellCookie(res.headers);
    return res;
  } catch (err) {
    console.error("[api/auth/desktop-dev] failed:", err);
    return NextResponse.redirect(desktopAppUrl("/api/auth/desktop-ui?error=Dev+bypass+failed"));
  }
}
