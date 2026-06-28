/**
 * POST /api/auth/desktop-login
 *
 * Native HTML form handler for the Tauri auth screen. Works without client JS
 * (Safari 15 WebView can't run Next.js dev bundles). Sets a NextAuth JWT cookie
 * and redirects back to /desktop.
 */
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { encode } from "next-auth/jwt";
import { db } from "@/lib/db";
import { appendDesktopShellCookie } from "@/lib/desktop/shell-cookie";
import { desktopAppUrl } from "@/lib/desktop/desktop-origin";
import { sessionCookieName, useSecureSessionCookies } from "@/lib/desktop/session-cookie";

async function setSessionCookie(res: NextResponse, user: { id: string; email: string; name: string | null }) {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not configured");

  const token = await encode({
    token: {
      sub: user.id,
      email: user.email,
      name: user.name ?? undefined,
      userId: user.id,
    },
    secret,
  });

  const secure = useSecureSessionCookies();
  res.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure,
    maxAge: 30 * 24 * 60 * 60,
  });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const form = await req.formData();

  const mode = String(form.get("mode") ?? "signin");
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase();
  const password = String(form.get("password") ?? "");
  const name = String(form.get("name") ?? "").trim();
  const isSignup = mode === "signup";

  const fail = (message: string) => {
    const redirect = desktopAppUrl("/api/auth/desktop-ui");
    redirect.searchParams.set("error", message);
    redirect.searchParams.set("mode", mode);
    return NextResponse.redirect(redirect);
  };

  if (!email || !password) return fail("Enter your email and password.");
  if (isSignup && !name) return fail("Enter your name.");

  try {
    if (isSignup) {
      const existing = await db.user.findUnique({ where: { email } });
      if (existing) return fail("An account with that email already exists.");

      const passwordHash = await bcrypt.hash(password, 10);
      const created = await db.user.create({
        data: { email, name, passwordHash, provider: "credentials" },
      });

      const res = NextResponse.redirect(desktopAppUrl("/desktop"));
      await setSessionCookie(res, created);
      appendDesktopShellCookie(res.headers);
      return res;
    }

    const user = await db.user.findUnique({ where: { email } });
    if (!user?.passwordHash) return fail("Wrong email or password.");
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return fail("Wrong email or password.");

    const res = NextResponse.redirect(desktopAppUrl("/desktop"));
    await setSessionCookie(res, user);
    appendDesktopShellCookie(res.headers);
    return res;
  } catch (err) {
    console.error("[api/auth/desktop-login] failed:", err);
    return fail("Something went wrong. Try again.");
  }
}
