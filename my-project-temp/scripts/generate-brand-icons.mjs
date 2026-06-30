#!/usr/bin/env node
/**
 * Generate favicons, PWA icons, and Tauri icon set from apical_clean.svg.
 */
import { readFile, copyFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const REPO_ROOT = path.join(ROOT, "..");
const CLEAN_SVG = path.join(REPO_ROOT, "apical_clean.svg");
const ANIMATED_SVG = path.join(REPO_ROOT, "apical_animated.svg");
const PUBLIC = path.join(ROOT, "public");
const TAURI_ICONS = path.join(ROOT, "src-tauri", "icons");

const ICON_BG = "#0d0d0d";

function parseViewBox(svg) {
  const m = svg.match(/viewBox="([^"]+)"/);
  const parts = (m?.[1] ?? "0 0 465 341").split(/\s+/).map(Number);
  return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
}

async function renderIconPng(size, outPath) {
  const svg = await readFile(CLEAN_SVG, "utf8");
  const { w, h } = parseViewBox(svg);
  const paths = svg.match(/<path[^>]+\/>/g)?.join("\n    ") ?? "";
  const pad = Math.max(w, h) * 0.08;
  const square = Math.max(w, h) + pad * 2;
  const offsetX = (square - w) / 2;
  const offsetY = (square - h) / 2;

  const composed = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${square} ${square}">
  <rect width="${square}" height="${square}" fill="${ICON_BG}"/>
  <g transform="translate(${offsetX}, ${offsetY})">
    ${paths}
  </g>
</svg>`;

  await sharp(Buffer.from(composed))
    .resize(size, size)
    .png()
    .toFile(outPath);
  console.log(`  ${outPath} (${size}px)`);
}

async function copySvgs() {
  await copyFile(CLEAN_SVG, path.join(PUBLIC, "apical-mark.svg"));
  await copyFile(CLEAN_SVG, path.join(PUBLIC, "logo.svg"));
  await copyFile(ANIMATED_SVG, path.join(PUBLIC, "apical-mark-animated.svg"));
  console.log("Copied SVG assets to public/");
}

async function generatePublicIcons() {
  const sizes = [
    [16, "icon-16.png"],
    [32, "icon-32.png"],
    [48, "icon-48.png"],
    [180, "apple-touch-icon.png"],
    [192, "icon-192.png"],
    [512, "icon-512.png"],
    [512, "apical-mark.png"],
    [1024, "apical-full.png"],
  ];
  for (const [size, name] of sizes) {
    await renderIconPng(size, path.join(PUBLIC, name));
  }

  try {
    execSync(`bun tauri icon "${path.join(PUBLIC, "apical-full.png")}" -o "${TAURI_ICONS}"`, {
      cwd: ROOT,
      stdio: "inherit",
    });
    await copyFile(path.join(TAURI_ICONS, "icon.ico"), path.join(PUBLIC, "favicon.ico"));
  } catch (e) {
    console.warn("tauri icon failed, writing 32px favicon from PNG:", e.message);
    await copyFile(path.join(PUBLIC, "icon-32.png"), path.join(PUBLIC, "favicon.ico"));
  }
}

async function main() {
  console.log("Generating brand icons from apical_clean.svg …");
  await copySvgs();
  await generatePublicIcons();
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
