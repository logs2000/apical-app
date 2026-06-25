/** Preview/sandbox items surfaced in the right-rail panel (not in chat). */

export type SandboxDisplayKind =
  | 'search'
  | 'http'
  | 'code'
  | 'cli'
  | 'data'
  | 'workflow'
  | 'info'
  | 'image'
  | 'file'

/** How a Preview deliverable should be rendered for the user. */
export type PreviewFormat = 'table' | 'image' | 'file' | 'markdown' | 'text' | 'html'

export interface SandboxItem {
  id: string
  title: string
  summary: string
  kind: SandboxDisplayKind
  tool: string
  ok: boolean
  output: unknown
  error?: string
  assetId?: string
  assetUrl?: string
  assetName?: string
  mimeType?: string
  /** True when this item is a user-facing deliverable (Preview tab). */
  isResult: boolean
  /** Preferred rendering when shown in Preview. */
  resultFormat?: PreviewFormat
  timestamp: string
}

export interface SandboxDisplayHint {
  title?: string
  summary?: string
  kind?: SandboxDisplayKind
  assetId?: string
  assetUrl?: string
  assetName?: string
  mimeType?: string
  /** Explicitly mark output as a user deliverable for Preview. */
  deliverable?: boolean
  format?: PreviewFormat
}

/** Whether an observation should appear in the Progress panel at all. */
export function shouldPreviewObservation(
  tool: string,
  ok: boolean,
  display?: SandboxDisplayHint,
  output?: unknown,
): boolean {
  if (display) return true
  if (!ok) return true
  if (output == null || output === '') return false
  if (typeof output === 'object') return true
  if (typeof output === 'string' && output.trim().length > 0) return true
  return false
}

/** Extract tabular rows from common API / query shapes. */
export function extractTableRows(output: unknown): Record<string, unknown>[] | null {
  if (Array.isArray(output) && output.length > 0 && typeof output[0] === 'object' && output[0] !== null) {
    return output as Record<string, unknown>[]
  }
  if (typeof output !== 'object' || output === null) return null
  const obj = output as Record<string, unknown>

  for (const key of ['rows', 'data', 'items', 'results', 'records']) {
    const val = obj[key]
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === 'object' && val[0] !== null) {
      return val as Record<string, unknown>[]
    }
  }

  // http_request wrapper: { body: [...] } or { body: { data: [...] } }
  const body = obj.body
  if (Array.isArray(body) && body.length > 0 && typeof body[0] === 'object' && body[0] !== null) {
    return body as Record<string, unknown>[]
  }
  if (typeof body === 'object' && body !== null) {
    return extractTableRows(body)
  }

  return null
}

function isImageMime(mime?: string): boolean {
  return !!mime && mime.startsWith('image/')
}

function looksLikeHtml(text: string): boolean {
  const s = text.trim().slice(0, 500).toLowerCase()
  return s.includes('<html') || s.includes('<!doctype') || (s.includes('<body') && s.includes('</'))
}

/** Classify whether tool output is a user-facing Preview deliverable. */
export function classifyDeliverable(
  tool: string,
  ok: boolean,
  output: unknown,
  display?: SandboxDisplayHint,
): { format: PreviewFormat } | null {
  if (!ok) return null

  // Saved files / images are always deliverables.
  if (display?.assetId || display?.assetUrl || tool === 'asset_save') {
    const mime = display?.mimeType
    if (display?.kind === 'image' || isImageMime(mime)) return { format: 'image' }
    return { format: 'file' }
  }

  if (display?.deliverable && display.format) {
    return { format: display.format }
  }

  // Tabular query results.
  if (tool === 'data_table_query') {
    const rows = extractTableRows(output)
    if (rows && rows.length > 0) return { format: 'table' }
    return null
  }

  // API responses that return structured lists the user asked for.
  if (tool === 'http_request') {
    const rows = extractTableRows(output)
    if (rows && rows.length > 0) return { format: 'table' }
    if (typeof output === 'object' && output !== null) {
      const body = (output as Record<string, unknown>).body
      if (typeof body === 'string' && body.length > 200 && looksLikeHtml(body)) {
        return { format: 'html' }
      }
    }
    return null
  }

  // Everything else (code runs, fs ops, web reads, credential checks, etc.)
  // is working noise — Progress only, never Preview.
  return null
}

export function sandboxItemFromObservation(
  tool: string,
  ok: boolean,
  output: unknown,
  display?: SandboxDisplayHint,
  error?: string,
): SandboxItem {
  const kind = display?.kind ?? inferKind(tool, output)
  const deliverable = classifyDeliverable(tool, ok, output, display)
  return {
    id: `sb-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: display?.title ?? humanizeTool(tool),
    summary: display?.summary ?? (ok ? 'Completed' : error ?? 'Failed'),
    kind,
    tool,
    ok,
    output,
    error,
    assetId: display?.assetId,
    assetUrl: display?.assetUrl,
    assetName: display?.assetName,
    mimeType: display?.mimeType,
    isResult: deliverable != null,
    resultFormat: deliverable?.format,
    timestamp: new Date().toISOString(),
  }
}

/** Build a Preview item from a produced attachment (end-of-run deliverable). */
export function sandboxItemFromAttachment(att: {
  id: string
  name: string
  mimeType: string
  kind: string
  url: string
  sizeBytes?: number
}): SandboxItem {
  const isImage = att.kind === 'image' || isImageMime(att.mimeType)
  return {
    id: `sb-asset-${att.id}`,
    title: att.name,
    summary: att.sizeBytes ? `${Math.round(att.sizeBytes / 1024)} KB` : 'Saved file',
    kind: isImage ? 'image' : 'file',
    tool: 'asset_save',
    ok: true,
    output: { assetId: att.id, url: att.url, name: att.name, sizeBytes: att.sizeBytes },
    assetId: att.id,
    assetUrl: att.url,
    assetName: att.name,
    mimeType: att.mimeType,
    isResult: true,
    resultFormat: isImage ? 'image' : 'file',
    timestamp: new Date().toISOString(),
  }
}

function humanizeTool(tool: string): string {
  return tool.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

function inferKind(tool: string, output: unknown): SandboxDisplayKind {
  if (tool === 'code_eval' || tool === 'script_run') return 'code'
  if (tool === 'cli_run') return 'cli'
  if (tool.startsWith('data_table')) return 'data'
  if (tool === 'http_request' || tool === 'web_read') return 'http'
  if (typeof output === 'string' && output.startsWith('data:image')) return 'image'
  return 'data'
}

/** Format output for display — returns string or structured rows for tables. */
export function formatSandboxOutput(output: unknown): {
  text?: string
  rows?: Record<string, unknown>[]
  html?: string
  isJson: boolean
} {
  const rows = extractTableRows(output)
  if (rows && rows.length > 0) return { rows, isJson: true }

  if (output == null) return { text: '', isJson: false }

  if (typeof output === 'object') {
    const obj = output as Record<string, unknown>
    const body = obj.body
    if (typeof body === 'string' && looksLikeHtml(body)) {
      return { html: body, isJson: false }
    }
    try {
      return { text: JSON.stringify(output, null, 2), isJson: true }
    } catch {
      return { text: String(output), isJson: false }
    }
  }

  const text = String(output)
  if (looksLikeHtml(text)) return { html: text, isJson: false }

  try {
    const parsed = JSON.parse(text)
    const parsedRows = extractTableRows(parsed)
    if (parsedRows) return { rows: parsedRows, isJson: true }
    return { text: JSON.stringify(parsed, null, 2), isJson: true }
  } catch {
    return { text, isJson: false }
  }
}

/** Formats that accumulate in Preview (files/images). Others replace the prior one. */
export function isAccumulatingDeliverable(format?: PreviewFormat): boolean {
  return format === 'file' || format === 'image'
}
