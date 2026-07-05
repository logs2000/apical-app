import { redirect } from "next/navigation";
import { AuthProvider } from "@/components/auth/AuthDialog";
import { DesktopAppClient } from "@/components/desktop/desktop-app-client";
import { getCurrentUser } from "@/lib/auth-helpers";

/** Desktop app entry — auth is a zero-JS HTML page at /api/auth/desktop-ui. */
export default async function DesktopPage() {
  const dbUser = await getCurrentUser();

  const user = dbUser
    ? {
        email: dbUser.email,
        name: dbUser.name ?? dbUser.email.split("@")[0],
      }
    : null;

  if (!user) {
    redirect("/api/auth/desktop-ui");
  }

  return (
    <AuthProvider variant="desktop" initialUser={user}>
      <DesktopAppClient user={user} />
    </AuthProvider>
  );
}
