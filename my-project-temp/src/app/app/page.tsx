import { WebAppClient } from "@/components/apical/web-app-client";

/**
 * /app — the standalone web app. Auth is checked on the client (see
 * WebAppClient) so it stays in sync with the session the rest of the app uses,
 * and a refresh lands directly in the app instead of flashing the landing page.
 */
export default function AppPage() {
  return <WebAppClient />;
}
