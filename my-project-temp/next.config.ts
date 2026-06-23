import type { NextConfig } from "next";

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
    "c-6a3756d8-14a687f1-6dec849cf0fd",
    "21.0.5.203",
    "localhost",
    // Wildcard patterns (Next.js supports `*.example.com` string wildcards).
    // The preview panel is served from preview-chat-<id>.space-z.ai (dynamic subdomain).
    "*.space-z.ai",
    "*.z.ai",
    "*.chatglm.cn",
  ],
};

export default nextConfig;
