import type { NextConfig } from "next";
import { config as loadEnv } from "dotenv";
import path from "path";

// Load repo-root .env (Apical/.env) then local overrides. Many devs keep
// provider keys in the monorepo root while Next.js runs from my-project-temp/.
// Skip repo-root .env on CI — Windows runners can hit EACCES scanning outside the project.
if (!process.env.CI) {
  loadEnv({ path: path.resolve(__dirname, "../.env") });
}
loadEnv({ path: path.resolve(__dirname, ".env.local") });

const nextConfig: NextConfig = {
  // Standalone output is for the Tauri desktop bundle (a long-running Node
  // server). On Vercel we use the default serverless output instead.
  output: process.env.VERCEL ? undefined : "standalone",
  // Desktop/Tauri builds only — on Vercel this breaks monorepo file tracing.
  ...(process.env.VERCEL ? {} : { outputFileTracingRoot: path.join(__dirname) }),
  // Tauri on macOS 12 uses Safari 15 WebKit — Turbopack emits syntax it can't
  // parse (named RegExp groups). Production builds must use webpack + browserslist.
  transpilePackages: [
    "framer-motion",
    "@mdxeditor/editor",
  ],
  // Server-only Node packages. Keeping them external stops webpack from pulling
  // their Node built-ins (child_process, node:process/stream, etc.) into the
  // client bundle via the instrumentation → folder-watch → runtime graph.
  serverExternalPackages: ["@modelcontextprotocol/sdk"],
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
  webpack: (config, { nextRuntime, webpack }) => {
    // Windows CI runners hit EACCES when webpack follows symlinked WindowsApps.
    config.resolve = config.resolve ?? {};
    config.resolve.symlinks = false;
    // The instrumentation hook is compiled for BOTH the Node.js and Edge
    // runtimes. Its register() dynamically imports the folder watcher — a deep
    // server-only chain (runtime, vault, webhooks, notifications, MCP stdio)
    // that uses Node built-ins — but bails out unless NEXT_RUNTIME === 'nodejs'.
    // The Edge compile still tries to resolve those built-ins and fails, so
    // stub them out of the Edge bundle only. The real Node.js server keeps the
    // native modules, and the client bundle is left untouched (it never imports
    // this chain) so Next.js' own browser polyfills stay intact.
    if (nextRuntime === "edge") {
      const stubbedNodeBuiltins = [
        "fs",
        "fs/promises",
        "path",
        "os",
        "crypto",
        "net",
        "dns",
        "dns/promises",
        "tls",
        "child_process",
        "stream",
        "process",
        "buffer",
        "events",
        "util",
        "url",
        "http",
        "https",
        "zlib",
      ];
      // Bare specifiers (e.g. require('fs')) resolve via resolve.fallback.
      config.resolve.fallback = {
        ...(config.resolve.fallback ?? {}),
        ...Object.fromEntries(stubbedNodeBuiltins.map((m) => [m, false])),
      };
      // `node:`-prefixed imports (e.g. import 'node:process') bypass fallback
      // and throw UnhandledSchemeError. Rewrite them to bare specifiers so they
      // hit the fallback stubs above.
      config.plugins = config.plugins ?? [];
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
    }
    if (process.env.CI && process.platform === "win32") {
      config.cache = false;
    }
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
