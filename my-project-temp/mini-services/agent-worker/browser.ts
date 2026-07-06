// Headless-browser session manager for the agent-worker. Playwright can't run
// on Vercel (serverless, no Chromium), so browsing lives here on the always-on
// host and the Next.js app drives it over a secret-guarded HTTP surface.
//
// One Chromium is shared; each session is a fresh context+page (isolated
// cookies). Sessions idle-close after 5 min and are capped per user + per host.

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { randomBytes } from 'crypto'

const VIEWPORT = { width: 1280, height: 800 }
const IDLE_MS = 5 * 60 * 1000
const MAX_PER_USER = Number(process.env.BROWSER_MAX_SESSIONS_PER_USER || 3)
const MAX_PER_HOST = Number(process.env.BROWSER_MAX_SESSIONS || 8)
const NAV_TIMEOUT = 30_000

interface Session {
  id: string
  userId: string
  context: BrowserContext
  page: Page
  lastUsed: number
  timer: ReturnType<typeof setTimeout>
}

const sessions = new Map<string, Session>()
let browserPromise: Promise<Browser> | null = null

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // PLAYWRIGHT_BROWSERS_PATH points at the preinstalled Chromium.
    browserPromise = chromium.launch({ headless: true }).catch((e) => {
      browserPromise = null
      throw e
    })
  }
  return browserPromise
}

function touch(session: Session): void {
  session.lastUsed = Date.now()
  clearTimeout(session.timer)
  session.timer = setTimeout(() => void closeSession(session.id), IDLE_MS)
}

export interface ActionResult {
  url: string
  title: string
  domSummary: string
  /** PNG screenshot bytes (base64). Omitted for close. */
  screenshotB64?: string
}

export async function createSession(userId: string): Promise<{ sessionId: string }> {
  const total = sessions.size
  const forUser = [...sessions.values()].filter((s) => s.userId === userId).length
  if (total >= MAX_PER_HOST) throw new Error('browser session limit reached on this host')
  if (forUser >= MAX_PER_USER) throw new Error('too many open browser sessions')

  const browser = await getBrowser()
  const context = await browser.newContext({ viewport: VIEWPORT, userAgent: undefined })
  const page = await context.newPage()
  page.setDefaultTimeout(NAV_TIMEOUT)
  const id = `br_${randomBytes(8).toString('hex')}`
  const session: Session = { id, userId, context, page, lastUsed: Date.now(), timer: setTimeout(() => void closeSession(id), IDLE_MS) }
  sessions.set(id, session)
  return { sessionId: id }
}

export async function closeSession(sessionId: string): Promise<void> {
  const s = sessions.get(sessionId)
  if (!s) return
  clearTimeout(s.timer)
  sessions.delete(sessionId)
  await s.context.close().catch(() => {})
}

async function summarize(page: Page): Promise<ActionResult> {
  const url = page.url()
  const title = await page.title().catch(() => '')
  // A compact, text-only view of the page so non-vision models still get
  // something actionable (headings, links, visible text — capped).
  const domSummary = await page
    .evaluate(() => {
      const pick = (sel: string, n: number) =>
        Array.from(document.querySelectorAll(sel))
          .slice(0, n)
          .map((el) => (el.textContent || '').trim().replace(/\s+/g, ' '))
          .filter(Boolean)
      const headings = pick('h1,h2,h3', 20)
      const links = Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 40)
        .map((a) => {
          const t = (a.textContent || '').trim().replace(/\s+/g, ' ')
          return t ? `${t} -> ${(a as HTMLAnchorElement).href}` : ''
        })
        .filter(Boolean)
      const text = (document.body?.innerText || '').replace(/\s+/g, ' ').slice(0, 4000)
      return `HEADINGS:\n${headings.join('\n')}\n\nLINKS:\n${links.join('\n')}\n\nTEXT:\n${text}`
    })
    .catch(() => '')
  const shot = await page.screenshot({ type: 'png' }).catch(() => null)
  return { url, title, domSummary, screenshotB64: shot ? shot.toString('base64') : undefined }
}

export interface ActParams {
  action: 'navigate' | 'click' | 'type' | 'press' | 'scroll' | 'screenshot' | 'back' | 'wait'
  url?: string
  selector?: string
  text?: string
  key?: string
  deltaY?: number
  timeoutMs?: number
}

export async function act(sessionId: string, params: ActParams): Promise<ActionResult> {
  const session = sessions.get(sessionId)
  if (!session) throw new Error('browser session not found (it may have idled out — open a new one)')
  touch(session)
  const { page } = session
  const timeout = Math.min(params.timeoutMs ?? NAV_TIMEOUT, 60_000)

  switch (params.action) {
    case 'navigate':
      if (!params.url) throw new Error('navigate requires url')
      await page.goto(params.url, { waitUntil: 'domcontentloaded', timeout })
      break
    case 'click':
      if (!params.selector) throw new Error('click requires selector')
      await page.click(params.selector, { timeout })
      break
    case 'type':
      if (!params.selector) throw new Error('type requires selector')
      await page.fill(params.selector, params.text ?? '', { timeout })
      break
    case 'press':
      await page.keyboard.press(params.key ?? 'Enter')
      break
    case 'scroll':
      await page.mouse.wheel(0, params.deltaY ?? 600)
      await page.waitForTimeout(300)
      break
    case 'back':
      await page.goBack({ waitUntil: 'domcontentloaded', timeout }).catch(() => {})
      break
    case 'wait':
      await page.waitForTimeout(Math.min(params.timeoutMs ?? 1000, 10_000))
      break
    case 'screenshot':
      break
    default:
      throw new Error(`unknown browser action: ${params.action}`)
  }
  return summarize(page)
}

export function sessionCount(): number {
  return sessions.size
}
