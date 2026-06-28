"use client";

import { DesktopApp } from "./desktop-app";

/** Client wrapper so AuthProvider context is available after server auth check. */
export function DesktopAppClient({ user }: { user: { email: string; name: string } }) {
  return <DesktopApp user={user} />;
}
