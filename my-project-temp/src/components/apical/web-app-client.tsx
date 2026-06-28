"use client";

import * as React from "react";
import { useSession } from "@/lib/supabase/session-context";
import { AuthProvider } from "@/components/auth/AuthDialog";
import { AppShell } from "@/components/apical/app-shell";

/**
 * WebAppClient — mounts the real Apical app shell as a standalone, full-screen
 * page (at "/app"), with no marketing page underneath. Auth is verified on the
 * client via the same session the rest of the app uses (this also works with
 * the dev auth bypass, which server-side getServerSession does not see). If the
 * visitor isn't signed in, we send them to the marketing site.
 */
export function WebAppClient() {
  const { data: session, status } = useSession();

  React.useEffect(() => {
    if (status === "unauthenticated") {
      window.location.assign("/");
    }
  }, [status]);

  const email = session?.user?.email;

  if (status !== "authenticated" || !email) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-background">
        <span className="text-sm text-muted-foreground">Loading…</span>
      </div>
    );
  }

  const user = {
    email,
    name: session.user?.name ?? email.split("@")[0],
  };

  return (
    <AuthProvider variant="web">
      <div className="h-screen w-screen overflow-hidden">
        <AppShell user={user} />
      </div>
    </AuthProvider>
  );
}
