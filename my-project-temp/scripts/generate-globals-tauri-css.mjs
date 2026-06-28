/**
 * Regenerate src/app/globals-tauri.css from neutral theme RGB tokens.
 * Run: node scripts/generate-globals-tauri-css.mjs
 */
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const lightTokens = {
  background: [250, 250, 250],
  foreground: [23, 23, 23],
  card: [255, 255, 255],
  popover: [255, 255, 255],
  primary: [23, 23, 23],
  "primary-foreground": [250, 250, 250],
  secondary: [245, 245, 245],
  "secondary-foreground": [38, 38, 38],
  muted: [245, 245, 245],
  "muted-foreground": [82, 82, 82],
  accent: [238, 238, 238],
  "accent-foreground": [23, 23, 23],
  destructive: [220, 38, 38],
  border: [229, 229, 229],
  input: [229, 229, 229],
  ring: [115, 115, 115],
  brand: [45, 106, 79],
  "brand-foreground": [250, 250, 250],
  reason: [59, 130, 246],
  "reason-foreground": [255, 255, 255],
  tool: [245, 245, 245],
  "tool-foreground": [64, 64, 64],
  gate: [217, 119, 6],
  "gate-foreground": [23, 23, 23],
  hardened: [71, 85, 105],
  "hardened-foreground": [255, 255, 255],
  "chart-1": [115, 115, 115],
  "chart-2": [163, 163, 163],
  "chart-3": [82, 82, 82],
  "chart-4": [212, 212, 212],
  "chart-5": [64, 64, 64],
};

const darkTokens = {
  background: [10, 10, 10],
  foreground: [245, 245, 245],
  card: [23, 23, 23],
  popover: [23, 23, 23],
  primary: [245, 245, 245],
  "primary-foreground": [10, 10, 10],
  secondary: [38, 38, 38],
  "secondary-foreground": [245, 245, 245],
  muted: [38, 38, 38],
  "muted-foreground": [163, 163, 163],
  accent: [38, 38, 38],
  "accent-foreground": [245, 245, 245],
  destructive: [239, 68, 68],
  ring: [163, 163, 163],
  brand: [74, 155, 111],
  "brand-foreground": [10, 10, 10],
  reason: [96, 165, 250],
  "reason-foreground": [10, 10, 10],
  tool: [38, 38, 38],
  "tool-foreground": [163, 163, 163],
  gate: [251, 191, 36],
  "gate-foreground": [10, 10, 10],
  hardened: [148, 163, 184],
  "hardened-foreground": [10, 10, 10],
  "chart-1": [163, 163, 163],
  "chart-2": [115, 115, 115],
  "chart-3": [212, 212, 212],
  "chart-4": [82, 82, 82],
  "chart-5": [245, 245, 245],
};

/** Dark-mode input/border tokens are white-at-alpha — not solid RGB. */
const DARK_ALPHA_BASE = {
  input: 0.16,
  border: 0.12,
};

const staticColors = {
  "emerald-500": [16, 185, 129],
  "emerald-600": [5, 150, 105],
  "emerald-900": [6, 78, 59],
  "emerald-100": [209, 250, 229],
  "orange-500": [249, 115, 22],
  "orange-800": [154, 52, 18],
  "orange-950": [67, 20, 7],
  "orange-200": [254, 215, 170],
  "orange-100": [255, 237, 213],
  "amber-500": [245, 158, 11],
  "amber-600": [217, 119, 6],
  "amber-950": [69, 26, 3],
  "red-300": [252, 165, 165],
  "red-400": [248, 113, 113],
  "red-50": [254, 242, 242],
  "zinc-600": [82, 82, 91],
};

const themeColors = {};
for (const [k, v] of Object.entries(lightTokens)) {
  themeColors[k] = { light: v, dark: darkTokens[k] || v };
}
for (const [k, v] of Object.entries(staticColors)) {
  themeColors[k] = { light: v, dark: v };
}

const opacities = [5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 90];
const props = [
  { cls: "bg", prop: "background-color" },
  { cls: "text", prop: "color" },
  { cls: "border", prop: "border-color" },
  { cls: "outline", prop: "outline-color" },
];

function rgba(rgb, pct) {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${pct / 100})`;
}

function darkChannelValue(name, pct) {
  if (name in DARK_ALPHA_BASE) {
    const a = DARK_ALPHA_BASE[name] * (pct / 100);
    return `rgba(255, 255, 255, ${a.toFixed(4)})`;
  }
  return rgba(themeColors[name].dark, pct);
}

function needsDarkOverride(name, modes) {
  return name in DARK_ALPHA_BASE || JSON.stringify(modes.dark) !== JSON.stringify(modes.light);
}

function esc(s) {
  return s.replace(/\//g, "\\/");
}

/** Escape a Tailwind utility class name for use in a CSS class selector. */
function escTailwindClass(className) {
  return className
    .replace(/\\/g, "\\\\")
    .replace(/\./g, "\\.")
    .replace(/\//g, "\\/")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/=/g, "\\=");
}
function rgbDecl(rgb) {
  return `rgb(${rgb.join(" ")})`;
}

let out = `/**
 * Tauri / Safari 15 WebKit compatibility layer (auto-generated).
 * Run: node scripts/generate-globals-tauri-css.mjs
 */

html[data-tauri] {
`;
for (const [k, v] of Object.entries(lightTokens)) {
  out += `  --${k}: ${rgbDecl(v)};\n`;
}
out += `  --card-foreground: ${rgbDecl(lightTokens.foreground)};\n`;
out += `  --popover-foreground: ${rgbDecl(lightTokens.foreground)};\n`;
out += `  --sidebar: ${rgbDecl([250, 250, 250])};\n`;
out += `  --sidebar-foreground: ${rgbDecl(lightTokens.foreground)};\n`;
out += `  --sidebar-primary: ${rgbDecl(lightTokens.primary)};\n`;
out += `  --sidebar-primary-foreground: ${rgbDecl(lightTokens["primary-foreground"])};\n`;
out += `  --sidebar-accent: ${rgbDecl(lightTokens.accent)};\n`;
out += `  --sidebar-accent-foreground: ${rgbDecl(lightTokens["accent-foreground"])};\n`;
out += `  --sidebar-border: ${rgbDecl(lightTokens.border)};\n`;
out += `  --sidebar-ring: ${rgbDecl(lightTokens.ring)};\n`;
out += `}\n\nhtml.dark[data-tauri] {\n`;
for (const [k, v] of Object.entries(darkTokens)) {
  out += `  --${k}: ${rgbDecl(v)};\n`;
}
out += `  --border: rgba(255, 255, 255, 0.12);\n`;
out += `  --input: rgba(255, 255, 255, 0.16);\n`;
out += `  --card-foreground: ${rgbDecl(darkTokens.foreground)};\n`;
out += `  --popover-foreground: ${rgbDecl(darkTokens.foreground)};\n`;
out += `  --sidebar: ${rgbDecl(darkTokens.card)};\n`;
out += `  --sidebar-foreground: ${rgbDecl(darkTokens.foreground)};\n`;
out += `  --sidebar-primary: ${rgbDecl(darkTokens.primary)};\n`;
out += `  --sidebar-primary-foreground: ${rgbDecl(darkTokens["primary-foreground"])};\n`;
out += `  --sidebar-accent: ${rgbDecl(darkTokens.accent)};\n`;
out += `  --sidebar-accent-foreground: ${rgbDecl(darkTokens["accent-foreground"])};\n`;
out += `  --sidebar-border: rgba(255, 255, 255, 0.12);\n`;
out += `  --sidebar-ring: ${rgbDecl(darkTokens.ring)};\n`;
out += `}\n\n`;

out += `@layer base {\n`;
out += `  html[data-tauri] * { outline-color: ${rgba(lightTokens.ring, 50)}; }\n`;
out += `  html.dark[data-tauri] * { outline-color: ${rgba(darkTokens.ring, 50)}; }\n`;
out += `}\n\n@layer utilities {\n`;

for (const [name, modes] of Object.entries(themeColors)) {
  for (const pct of opacities) {
    for (const { cls, prop } of props) {
      const selector = `.${esc(`${cls}-${name}/${pct}`)}`;
      out += `  html[data-tauri] ${selector} { ${prop}: ${rgba(modes.light, pct)}; }\n`;
      if (needsDarkOverride(name, modes)) {
        out += `  html.dark[data-tauri] ${selector} { ${prop}: ${darkChannelValue(name, pct)}; }\n`;
      }
    }
  }
}

for (const [name] of Object.entries(themeColors)) {
  for (const pct of opacities) {
    const bgSel = `.dark\\:${esc(`bg-${name}/${pct}`)}`;
    const borderSel = `.dark\\:${esc(`border-${name}/${pct}`)}`;
    out += `  html.dark[data-tauri] ${bgSel} { background-color: ${darkChannelValue(name, pct)}; }\n`;
    out += `  html.dark[data-tauri] ${borderSel} { border-color: ${darkChannelValue(name, pct)}; }\n`;
  }
}

for (const [name, modes] of Object.entries(themeColors)) {
  for (const pct of [40, 50]) {
    for (const prefix of ["", ".focus-visible\\:"]) {
      const base = prefix ? `${prefix}${esc(`ring-${name}/${pct}`)}:focus-visible` : `.${esc(`ring-${name}/${pct}`)}`;
      out += `  html[data-tauri] ${base} { --tw-ring-color: ${rgba(modes.light, pct)}; }\n`;
      if (needsDarkOverride(name, modes)) {
        out += `  html.dark[data-tauri] ${base} { --tw-ring-color: ${darkChannelValue(name, pct)}; }\n`;
      }
      const darkRing = prefix
        ? `.dark\\:${prefix.slice(1)}${esc(`ring-${name}/${pct}`)}:focus-visible`
        : `.dark\\:${esc(`ring-${name}/${pct}`)}`;
      out += `  html.dark[data-tauri] ${darkRing} { --tw-ring-color: ${darkChannelValue(name, pct)}; }\n`;
    }
  }
}

const hoverRules = [
  ["hover:bg-accent/50", "background-color", "accent", 50],
  ["hover:bg-accent/60", "background-color", "accent", 60],
  ["hover:bg-primary/90", "background-color", "primary", 90],
  ["hover:bg-accent/30", "background-color", "accent", 30],
  ["hover:bg-background/60", "background-color", "background", 60],
  ["hover:border-border/80", "border-color", "border", 80],
  ["hover:border-foreground/30", "border-color", "foreground", 30],
  ["hover:text-foreground/80", "color", "foreground", 80],
  ["hover:text-brand/80", "color", "brand", 80],
];

for (const [sel, prop, color, pct] of hoverRules) {
  const modes = themeColors[color];
  const escaped = `${escTailwindClass(sel)}:hover`;
  out += `  html[data-tauri] .${escaped} { ${prop}: ${rgba(modes.light, pct)}; }\n`;
  if (needsDarkOverride(color, modes)) {
    out += `  html.dark[data-tauri] .${escaped} { ${prop}: ${darkChannelValue(color, pct)}; }\n`;
  }
}

const darkHoverRules = [
  ["dark:hover:bg-accent/50", "background-color", "accent", 50],
  ["dark:hover:bg-input/50", "background-color", "input", 50],
  ["dark:hover:bg-accent/30", "background-color", "accent", 30],
];
for (const [sel, prop, color, pct] of darkHoverRules) {
  const escaped = `${escTailwindClass(sel)}:hover`;
  out += `  html.dark[data-tauri] .${escaped} { ${prop}: ${darkChannelValue(color, pct)}; }\n`;
}

const darkStateRules = [
  ["dark:data-[state=active]:bg-input/30", "background-color", "input", 30],
  ["dark:data-[state=active]:border-input", "border-color", "input", 100],
  ["dark:data-[state=unchecked]:bg-input/80", "background-color", "input", 80],
  ["dark:bg-input/30", "background-color", "input", 30],
  ["data-[state=open]:bg-accent/50", "background-color", "accent", 50],
  ["data-[state=active]:bg-accent/50", "background-color", "accent", 50],
];
for (const [sel, prop, color, pct] of darkStateRules) {
  const escaped = escTailwindClass(sel);
  const value =
    color === "input" && pct === 100
      ? { light: rgba(lightTokens.input, 100), dark: "rgba(255, 255, 255, 0.16)" }
      : { light: rgba(themeColors[color].light, pct), dark: darkChannelValue(color, pct) };
  if (sel.startsWith("dark:")) {
    out += `  html.dark[data-tauri] .${escaped} { ${prop}: ${value.dark}; }\n`;
  } else {
    out += `  html[data-tauri] .${escaped} { ${prop}: ${value.light}; }\n`;
    out += `  html.dark[data-tauri] .${escaped} { ${prop}: ${value.dark}; }\n`;
  }
}

out += `  html[data-tauri] .${escTailwindClass("even:bg-muted/30")}:nth-child(even) { background-color: ${rgba(themeColors.muted.light, 30)}; }\n`;
out += `  html.dark[data-tauri] .${escTailwindClass("even:bg-muted/30")}:nth-child(even) { background-color: ${rgba(themeColors.muted.dark, 30)}; }\n`;
out += `  html[data-tauri] .${escTailwindClass("from-brand/5")} { --tw-gradient-from: ${rgba(themeColors.brand.light, 5)} var(--tw-gradient-from-position); --tw-gradient-to: rgb(255 255 255 / 0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }\n`;
out += `  html.dark[data-tauri] .${escTailwindClass("from-brand/5")} { --tw-gradient-from: ${rgba(themeColors.brand.dark, 5)} var(--tw-gradient-from-position); --tw-gradient-to: rgb(255 255 255 / 0) var(--tw-gradient-to-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); }\n`;

const groupRules = [
  ["group-[.destructive]:border-muted/40", "border-color", "muted", 40],
  ["group-[.destructive]:hover:border-destructive/30", "border-color", "destructive", 30],
  ["group-[.warning]:border-orange-500/30", "border-color", "orange-500", 30],
  ["group-[.warning]:hover:bg-orange-500/15", "background-color", "orange-500", 15],
  ["group-[.warning]:focus:ring-orange-500/40", "--tw-ring-color", "orange-500", 40],
  ["group-[.warning]:text-orange-800/60", "color", "orange-800", 60],
];
for (const [sel, prop, color, pct] of groupRules) {
  const rgb = staticColors[color] || themeColors[color]?.light;
  out += `  html[data-tauri] .${escTailwindClass(sel)} { ${prop}: ${rgba(rgb, pct)}; }\n`;
}

out += `  html.dark[data-tauri] .dark\\:text-emerald-100\\/80 { color: rgba(209, 250, 229, 0.8); }\n`;
out += `  html.dark[data-tauri] .dark\\:text-orange-100 { color: rgb(255, 237, 213); }\n`;
out += `  html.dark[data-tauri] .dark\\:text-orange-200\\/80 { color: rgba(254, 215, 170, 0.8); }\n`;

out += `\n  html[data-tauri] .backdrop-blur-sm { -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); }\n`;
out += `  html[data-tauri] .backdrop-blur { -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }\n`;
out += `  html[data-tauri] .backdrop-blur-md { -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px); }\n`;
out += `  html[data-tauri] .backdrop-blur-lg { -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); }\n`;

const glassSelectors = [
  "header.backdrop-blur-md",
  "header.backdrop-blur-lg",
  "header.backdrop-blur",
  "footer.backdrop-blur-md",
  "footer.backdrop-blur-lg",
  "thead.backdrop-blur",
  "thead.backdrop-blur-sm",
];
for (const sel of glassSelectors) {
  out += `  html[data-tauri] ${sel} { background-color: rgba(250, 250, 250, 0.82); }\n`;
  out += `  html.dark[data-tauri] ${sel} { background-color: rgba(10, 10, 10, 0.82); }\n`;
}

out += `}\n`;

writeFileSync(join(root, "src/app/globals-tauri.css"), out);
console.log(`Wrote ${out.length} bytes to src/app/globals-tauri.css`);
