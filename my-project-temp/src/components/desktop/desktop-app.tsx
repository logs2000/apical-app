"use client";

import { AppShell } from "@/components/apical/app-shell";

export function DesktopApp({ user }: { user: { email: string; name: string } }) {
  return (
    <div className="h-screen w-screen overflow-hidden">
      <AppShell user={user} />
    </div>
  );
}
