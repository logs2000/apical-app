import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "path";

// Load repo-root .env (Apical/.env) then local overrides. Many devs keep
// provider keys in the monorepo root while Next.js runs from my-project-temp/.
loadEnv({ path: path.resolve(__dirname, "../.env") });
loadEnv({ path: path.resolve(__dirname, ".env.local") });

const nextConfig: NextConfig = {
  output: "standalone",
  typescript: {
    // Do NOT silently swallow type errors at build time.
    // Surface them so production builds fail loudly when types drift.
    ignoreBuildErrors: false,
  },
  // Note: the `eslint` config key was removed in Next.js 16. ESLint is now
  // run separately via `next lint` (or `bun run lint`) — it does NOT run
  // during `next build` by default. CI should run `bun run lint` explicitly.
  reactStrictMode: true,
  allowedDevOrigins: [
    "localhost",
  ],
};

export default nextConfig;
