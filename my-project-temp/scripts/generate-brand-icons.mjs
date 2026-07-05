#!/usr/bin/env node
/**
 * Generate favicons, PWA icons, Tauri app icons, and tray/menu-bar icons
 * from apical_clean.svg — centered mark, squircle background, sized per HIG.
 */
import { readFile, copyFile } from 'node:fs/promises'
import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const REPO_ROOT = path.join(ROOT, '..')
const CLEAN_SVG = path.join(REPO_ROOT, 'apical_clean.svg')
const ANIMATED_SVG = path.join(REPO_ROOT, 'apical_animated.svg')
const PUBLIC = path.join(ROOT, 'public')
const TAURI_ICONS = path.join(ROOT, 'src-tauri', 'icons')

const ICON_BG = '#0d0d0d'
const MARK_PATHS = [
  'M231 0 L465 341 L373 341 L231 136 L91 341 L0 341 Z',
  'M231 249 L293 341 L169 341 Z',
]

/** Logo viewBox from apical_clean.svg */
const LOGO = { x: -14, y: -10, w: 493, h: 361 }

/** ~macOS squircle corner radius (22.37% of side). */
function squircleRadius(size) {
  return Math.round(size * 0.2237)
}

/**
 * Compose a square icon with the Apical mark centered and inset ~16%.
 * @param {object} opts
 * @param {number} opts.size
 * @param {string} opts.fill - mark color
 * @param {string|null} opts.bg - background fill, or null for transparent
 * @param {boolean} opts.rounded - clip background to squircle
 */
function buildIconSvg({ size, fill, bg = ICON_BG, rounded = true }) {
  const inset = size * 0.16
  const avail = size - inset * 2
  const scale = Math.min(avail / LOGO.w, avail / LOGO.h)
  const drawW = LOGO.w * scale
  const drawH = LOGO.h * scale
  const x = (size - drawW) / 2
  const y = (size - drawH) / 2
  const r = squircleRadius(size)
  const paths = MARK_PATHS.map((d) => `<path fill="${fill}" d="${d}"/>`).join('\n    ')
  const bgRect =
    bg == null
      ? ''
      : rounded
        ? `<rect width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${bg}"/>`
        : `<rect width="${size}" height="${size}" fill="${bg}"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  ${bgRect}
  <svg x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${drawW.toFixed(2)}" height="${drawH.toFixed(2)}" viewBox="${LOGO.x} ${LOGO.y} ${LOGO.w} ${LOGO.h}">
    ${paths}
  </svg>
</svg>`
}

async function renderSvgToPng(svg, outPath, size) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outPath)
  console.log(`  ${path.relative(ROOT, outPath)} (${size}px)`)
}

async function copySvgs() {
  await copyFile(CLEAN_SVG, path.join(PUBLIC, 'apical-mark.svg'))
  await copyFile(CLEAN_SVG, path.join(PUBLIC, 'logo.svg'))
  await copyFile(ANIMATED_SVG, path.join(PUBLIC, 'apical-mark-animated.svg'))
  console.log('Copied SVG assets to public/')
}

async function generatePublicIcons() {
  const masterSvg = buildIconSvg({ size: 1024, fill: '#ffffff', bg: ICON_BG, rounded: true })
  const sizes = [
    [16, 'icon-16.png'],
    [32, 'icon-32.png'],
    [48, 'icon-48.png'],
    [180, 'apple-touch-icon.png'],
    [192, 'icon-192.png'],
    [512, 'icon-512.png'],
    [512, 'apical-mark.png'],
    [1024, 'apical-full.png'],
  ]
  for (const [size, name] of sizes) {
    await renderSvgToPng(masterSvg, path.join(PUBLIC, name), size)
  }
}

async function generateTrayIcons() {
  // macOS menu-bar template: black silhouette + alpha → system tints for light/dark.
  const templateSvg = buildIconSvg({ size: 44, fill: '#000000', bg: null, rounded: false })
  await renderSvgToPng(templateSvg, path.join(TAURI_ICONS, 'tray-template.png'), 44)
  await renderSvgToPng(templateSvg, path.join(TAURI_ICONS, 'tray-template@2x.png'), 88)

  // Explicit variants for Windows / fallback (backgroundless).
  const lightModeSvg = buildIconSvg({ size: 44, fill: '#000000', bg: null, rounded: false })
  const darkModeSvg = buildIconSvg({ size: 44, fill: '#ffffff', bg: null, rounded: false })
  await renderSvgToPng(lightModeSvg, path.join(TAURI_ICONS, 'tray-light.png'), 44)
  await renderSvgToPng(darkModeSvg, path.join(TAURI_ICONS, 'tray-dark.png'), 44)
  await renderSvgToPng(lightModeSvg, path.join(TAURI_ICONS, 'tray-light@2x.png'), 88)
  await renderSvgToPng(darkModeSvg, path.join(TAURI_ICONS, 'tray-dark@2x.png'), 88)
}

async function generateTauriIcons() {
  const master = path.join(PUBLIC, 'apical-full.png')
  try {
    execSync(`npx tauri icon "${master}" -o "${TAURI_ICONS}"`, {
      cwd: ROOT,
      stdio: 'inherit',
    })
    await copyFile(path.join(TAURI_ICONS, 'icon.ico'), path.join(PUBLIC, 'favicon.ico'))
  } catch (e) {
    console.warn('tauri icon failed, writing favicon from 32px PNG:', e.message)
    await copyFile(path.join(PUBLIC, 'icon-32.png'), path.join(PUBLIC, 'favicon.ico'))
  }
}

async function main() {
  console.log('Generating brand icons from apical_clean.svg …')
  await copySvgs()
  await generatePublicIcons()
  await generateTrayIcons()
  await generateTauriIcons()
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
