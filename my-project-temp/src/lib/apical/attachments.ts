'use client'

import type { ChatAttachment } from '@/lib/apical'
import { IS_TAURI } from '@/lib/desktop/tauri-bridge'

export async function uploadFiles(files: File[], agentId?: string | null): Promise<ChatAttachment[]> {
  const form = new FormData()
  if (agentId) form.append('agentId', agentId)
  for (const file of files) form.append('files', file)
  const res = await fetch('/api/assets', { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `Upload failed (${res.status})`)
  }
  const data = (await res.json()) as { assets: ChatAttachment[] }
  return data.assets
}

export async function registerFolderPath(
  localPath: string,
  name?: string,
  agentId?: string | null,
): Promise<ChatAttachment> {
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'folder',
      localPath,
      name: name || localPath.split(/[/\\]/).pop() || localPath,
      agentId,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `Folder register failed (${res.status})`)
  }
  const data = (await res.json()) as { asset: ChatAttachment }
  return data.asset
}

/** Native file picker (Tauri) or hidden input fallback (web). */
export async function pickFiles(opts?: { multiple?: boolean; directory?: boolean }): Promise<ChatAttachment[]> {
  if (IS_TAURI) {
    return pickFilesTauri(opts)
  }
  return pickFilesWeb(opts)
}

async function pickFilesTauri(opts?: { multiple?: boolean; directory?: boolean }): Promise<ChatAttachment[]> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const selected = await open({
      multiple: opts?.multiple ?? true,
      directory: opts?.directory ?? false,
    })
    if (!selected) return []
    const paths = Array.isArray(selected) ? selected : [selected]
    if (opts?.directory) {
      const attachments: ChatAttachment[] = []
      for (const p of paths) {
        attachments.push(await registerFolderPath(String(p)))
      }
      return attachments
    }
    const { readFile } = await import('@tauri-apps/plugin-fs')
    const files: File[] = []
    for (const p of paths) {
      const pathStr = String(p)
      const name = pathStr.split(/[/\\]/).pop() || 'file'
      const bytes = await readFile(pathStr)
      const blob = new Blob([bytes])
      files.push(new File([blob], name))
    }
    return uploadFiles(files)
  } catch (e) {
    throw new Error(`Could not open file picker: ${(e as Error).message}`)
  }
}

function pickFilesWeb(opts?: { multiple?: boolean; directory?: boolean }): Promise<ChatAttachment[]> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = opts?.multiple ?? true
    if (opts?.directory) {
      input.setAttribute('webkitdirectory', '')
      input.setAttribute('directory', '')
    }

    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      window.removeEventListener('focus', onWindowFocus)
      fn()
    }

    input.onchange = async () => {
      try {
        const files = Array.from(input.files ?? [])
        if (files.length === 0) {
          finish(() => resolve([]))
          return
        }
        const assets = await uploadFiles(files)
        finish(() => resolve(assets))
      } catch (e) {
        finish(() => reject(e))
      }
    }

    // Fires when the user dismisses the picker without choosing (modern browsers).
    input.addEventListener('cancel', () => {
      finish(() => resolve([]))
    })

    // Fallback for browsers without `cancel`: when the picker closes, window regains focus.
    const onWindowFocus = () => {
      window.setTimeout(() => {
        if (settled) return
        const files = Array.from(input.files ?? [])
        if (files.length === 0) finish(() => resolve([]))
      }, 400)
    }
    window.addEventListener('focus', onWindowFocus)

    input.click()
  })
}

export async function listAssets(agentId?: string): Promise<ChatAttachment[]> {
  const qs = agentId ? `?agentId=${encodeURIComponent(agentId)}` : ''
  const res = await fetch(`/api/assets${qs}`)
  if (!res.ok) return []
  const data = (await res.json()) as { assets: ChatAttachment[] }
  return data.assets
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

// ─── Artifact create / edit / run ──────────────────────────────────────────

export type ScriptLanguage = 'javascript' | 'python' | 'shell'

export interface RunResult {
  ok: boolean
  output: unknown
  error?: string
}

/** Run a script once. JS executes in the server sandbox; py/shell need desktop. */
export async function runArtifact(
  language: ScriptLanguage,
  code: string,
  data?: string,
): Promise<RunResult> {
  const res = await fetch('/api/artifacts/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ language, code, data }),
  })
  const json = (await res.json().catch(() => ({}))) as RunResult & { error?: string }
  if (!res.ok && !json.error) {
    return { ok: false, output: null, error: `HTTP ${res.status}` }
  }
  return { ok: json.ok ?? res.ok, output: json.output ?? null, error: json.error }
}

const MIME_BY_EXT: Record<string, string> = {
  js: 'text/javascript',
  ts: 'text/typescript',
  py: 'text/x-python',
  sh: 'text/x-shellscript',
  json: 'application/json',
  csv: 'text/csv',
  md: 'text/markdown',
  txt: 'text/plain',
  html: 'text/html',
  css: 'text/css',
}

export function mimeForFilename(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'text/plain'
}

/** Save text content as a downloadable code/text artifact. */
export async function saveArtifact(input: {
  name: string
  content: string
  mimeType?: string
  agentId?: string | null
}): Promise<ChatAttachment> {
  const res = await fetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: input.name,
      content: input.content,
      mimeType: input.mimeType ?? mimeForFilename(input.name),
      kind: 'code',
      encoding: 'utf8',
      agentId: input.agentId ?? null,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as { error?: string }).error || `Save failed (${res.status})`)
  }
  const data = (await res.json()) as { asset: ChatAttachment }
  return data.asset
}

/** Fetch the text content of an existing asset (for editing). */
export async function fetchArtifactText(assetId: string): Promise<string> {
  const res = await fetch(`/api/assets/${assetId}/download`)
  if (!res.ok) throw new Error(`Could not load file (${res.status})`)
  return res.text()
}
