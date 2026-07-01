/** Client-side OS + Mac CPU detection for download routing. */

export type DetectedOS = "mac" | "windows" | "linux" | "other";
export type MacArch = "apple-silicon" | "intel" | "unknown";

export function detectOS(): DetectedOS {
  if (typeof navigator === "undefined") return "other";
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes("mac os x") || ua.includes("darwin")) return "mac";
  if (ua.includes("windows")) return "windows";
  if (ua.includes("linux")) return "linux";
  return "other";
}

/** Sync heuristic — fine for first paint; prefer `detectMacArch()` when async is ok. */
export function detectMacArchSync(): MacArch {
  if (typeof navigator === "undefined") return "unknown";
  if (/intel mac os x/i.test(navigator.userAgent)) return "intel";
  if (/mac os x|darwin/i.test(navigator.userAgent)) return "apple-silicon";
  return "unknown";
}

/** Chromium User-Agent Client Hints (not in default TS lib yet). */
type NavigatorUAData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{ architecture?: string }>;
};

/**
 * Best-effort Mac CPU detection.
 * Uses User-Agent Client Hints when available (Chrome/Edge), then UA string fallbacks.
 */
export async function detectMacArch(): Promise<MacArch> {
  if (typeof navigator === "undefined") return "unknown";

  const uaData = (navigator as Navigator & { userAgentData?: NavigatorUAData }).userAgentData;
  if (uaData?.platform === "macOS" && uaData.getHighEntropyValues) {
    try {
      const { architecture } = await uaData.getHighEntropyValues(["architecture"]);
      if (architecture === "arm") return "apple-silicon";
      if (architecture === "x86") return "intel";
    } catch {
      /* fall through */
    }
  }

  return detectMacArchSync();
}

export function macDownloadFilename(arch: MacArch): string {
  return arch === "intel" ? "apical-mac-intel.dmg" : "apical-mac.dmg";
}

export function downloadUrlFor(os: DetectedOS, macArch: MacArch = "apple-silicon"): string {
  const base = "/downloads";
  if (os === "mac") return `${base}/${macDownloadFilename(macArch)}`;
  if (os === "windows") return `${base}/apical-windows.exe`;
  if (os === "linux") return `${base}/apical-linux.AppImage`;
  return `${base}/`;
}

export function osLabel(os: DetectedOS): string {
  return os === "mac" ? "macOS" : os === "windows" ? "Windows" : os === "linux" ? "Linux" : "Pick platform";
}

export function macArchLabel(arch: MacArch): string {
  return arch === "intel" ? "macOS (Intel)" : arch === "apple-silicon" ? "macOS (Apple Silicon)" : "macOS";
}

export function downloadButtonLabel(os: DetectedOS, macArch: MacArch = "apple-silicon"): string {
  if (os === "other") return "Download";
  if (os === "mac") return `Download for ${macArchLabel(macArch)}`;
  return `Download for ${osLabel(os)}`;
}

export type PlatformChoice = {
  id: string;
  os: DetectedOS;
  macArch?: MacArch;
  label: string;
};

export const PLATFORM_CHOICES: PlatformChoice[] = [
  { id: "mac-as", os: "mac", macArch: "apple-silicon", label: macArchLabel("apple-silicon") },
  { id: "mac-intel", os: "mac", macArch: "intel", label: macArchLabel("intel") },
  { id: "windows", os: "windows", label: osLabel("windows") },
  { id: "linux", os: "linux", label: osLabel("linux") },
];
