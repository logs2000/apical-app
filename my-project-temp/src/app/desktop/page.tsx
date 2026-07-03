import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AuthProvider } from "@/components/auth/AuthDialog";
import { DesktopAppClient } from "@/components/desktop/desktop-app-client";
import { getDevAutoLoginUser } from "@/lib/dev-login";

/** Desktop app entry — auth is a zero-JS HTML page at /api/auth/desktop-ui. */
export default async function DesktopPage() {
  const session = await getServerSession(authOptions);

  let user = session?.user?.email
    ? {
        email: session.user.email,
        name: session.user.name ?? session.user.email.split("@")[0],
      }
    : null;

  // Dev-only: auto sign-in with DEV_AUTH_EMAIL so the shell renders without a
  // manual login. Inert in production / when unconfigured (see dev-login.ts).
  if (!user) {
    const devUser = await getDevAutoLoginUser();
    if (devUser) {
      user = {
        email: devUser.email,
        name: devUser.name ?? devUser.email.split("@")[0],
      };
    }
  }

  if (!user) {
    redirect("/api/auth/desktop-ui");
  }

  return (
    <AuthProvider variant="desktop">
      <DesktopAppClient user={user} />
    </AuthProvider>
  );
}
