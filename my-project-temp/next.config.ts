import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "path";

// Load repo-root .env (Apical/.env) then local overrides. Many devs keep
// provider keys in the monorepo root while Next.js runs from my-project-temp/.
loadEnv({ path: path.resolve(__dirname, "../.env") });
loadEnv({ path: path.resolve(__dirname, ".env.local") });

const nextConfig: NextConfig = {
  // Standalone output is for the Tauri desktop bundle (a long-running Node
  // server). On Vercel we use the default serverless output instead.
  output: process.env.VERCEL ? undefined : "standalone",
  // Tauri on macOS 12 uses Safari 15 WebKit — Turbopack emits syntax it can't
  // parse (named RegExp groups). Production builds must use webpack + browserslist.
  transpilePackages: [
    "framer-motion",
    "@mdxeditor/editor",
    "@modelcontextprotocol/sdk",
  ],
  typescript: {
    // Do NOT silently swallow type errors at build time.
    // Surface them so production builds fail loudly when types drift.
    ignoreBuildErrors: false,
  },
  // Note: the `eslint` config key was removed in Next.js 16. ESLint is now
  // run separately via `next lint` (or `bun run lint`) — it does NOT run
  // during `next build` by default. CI should run `bun run lint` explicitly.
  reactStrictMode: true,
  devIndicators: false,
  allowedDevOrigins: [
    "localhost",
    "127.0.0.1",
  ],
  webpack: (config) => {
    // Windows CI runners hit EACCES when webpack globs symlinked WindowsApps.
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/WindowsApps/**",
      ],
    };
    return config;
  },
  async headers() {
    return [
      {
        source: "/desktop",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
      {
        source: "/api/auth/desktop-ui",
        headers: [
          { key: "Cache-Control", value: "no-store, no-cache, must-revalidate" },
          { key: "Pragma", value: "no-cache" },
        ],
      },
    ];
  },
};

export default nextConfig;
