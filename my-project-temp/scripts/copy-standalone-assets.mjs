#!/usr/bin/env node
/** Copy static assets into .next/standalone after `next build` (cross-platform). */
import { cpSync, existsSync } from "node:fs";
import path from "node:path";

const standalone = path.join(".next", "standalone");
if (!existsSync(standalone)) process.exit(0);

cpSync(path.join(".next", "static"), path.join(standalone, ".next", "static"), {
  recursive: true,
});
cpSync("public", path.join(standalone, "public"), { recursive: true });
