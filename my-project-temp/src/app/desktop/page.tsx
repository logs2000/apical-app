import { redirect } from "next/navigation";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { AuthProvider } from "@/components/auth/AuthDialog";
import { DesktopAppClient } from "@/components/desktop/desktop-app-client";

/** Desktop app entry — auth is a zero-JS HTML page at /api/auth/desktop-ui. */
export default async function DesktopPage() {
  const session = await getServerSession(authOptions);

  const user = session?.user?.email
    ? {
        email: session.user.email,
        name: session.user.name ?? session.user.email.split("@")[0],
      }
    : null;

  if (!user) {
    redirect("/api/auth/desktop-ui");
  }

  return (
    <AuthProvider variant="desktop">
      <DesktopAppClient user={user} />
    </AuthProvider>
  );
}
