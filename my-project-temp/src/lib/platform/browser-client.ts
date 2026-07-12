// Client for the agent-worker's headless-browser surface. The Next.js app
// (Vercel — no Chromium) drives browsing on the always-on worker over HTTP,
// authenticated with AGENT_WORKER_SECRET. Screenshots come back as PNG base64
// and are downscaled here into model-ready ImageParts.

import { normalizeImage } from './images'
import type { ImagePart } from './llm-gateway'

const WORKER_URL = (process.env.AGENT_WORKER_URL || '').replace(/\/$/, '')
const WORKER_SECRET = (process.env.AGENT_WORKER_SECRET || '').trim()

/** True when browsing is available (worker configured). */
export function browserAvailable(): boolean {
  return !!WORKER_URL && !!WORKER_SECRET
}

export interface BrowserActParams {
  action: 'navigate' | 'click' | 'type' | 'press' | 'scroll' | 'screenshot' | 'back' | 'wait' | 'close'
  url?: string
  selector?: string
  text?: string
  key?: string
  deltaY?: number
  timeoutMs?: number
}

export interface BrowserActResult {
  url: string
  title: string
  domSummary: string
  image?: ImagePart
}

async function workerFetch(path: string, init: RequestInit, timeoutMs = 70_000): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(`${WORKER_URL}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', 'X-Worker-Secret': WORKER_SECRET, ...(init.headers || {}) },
      signal: ctrl.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}

export async function openBrowserSession(userId: string): Promise<string> {
  const res = await workerFetch('/browser/session', { method: 'POST', body: JSON.stringify({ userId }) }, 30_000)
  if (!res.ok) throw new Error(`browser session failed: ${(await res.text()).slice(0, 200)}`)
  return ((await res.json()) as { sessionId: string }).sessionId
}

export async function closeBrowserSession(sessionId: string): Promise<void> {
  await workerFetch(`/browser/${sessionId}`, { method: 'DELETE' }, 15_000).catch(() => {})
}

export async function browserAct(
  sessionId: string,
  params: BrowserActParams,
  opts: { downscaleImages?: boolean } = { downscaleImages: true },
): Promise<BrowserActResult> {
  const res = await workerFetch(`/browser/${sessionId}/act`, { method: 'POST', body: JSON.stringify(params) })
  if (!res.ok) throw new Error(`browser action failed: ${(await res.text()).slice(0, 300)}`)
  const data = (await res.json()) as { url: string; title: string; domSummary: string; screenshotB64?: string }
  let image: ImagePart | undefined
  if (data.screenshotB64 && opts.downscaleImages !== false) {
    try {
      const norm = await normalizeImage({
        bytes: Buffer.from(data.screenshotB64, 'base64'),
        label: `${params.action} — ${data.title || data.url}`,
      })
      image = { mimeType: norm.mimeType, base64: norm.base64, label: norm.label }
    } catch {
      /* screenshot optional */
    }
  }
  return { url: data.url, title: data.title, domSummary: data.domSummary, image }
}
