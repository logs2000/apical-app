// Document primitives — the vertical tool surface.
//
// These are the capabilities a real intake automation needs and that
// orchestration alone can't fake: read a scanned document into structured
// fields, fill a PDF form, and append a row to a spreadsheet.
//
// Nothing here knows anything about any particular vertical. They are
// primitives; the agent composes the workflow.
//
// File I/O is injected (`DocFileIO`) rather than imported, so this module
// stays free of the desktop-bridge machinery in agent-tools.ts and can be
// unit-tested against plain buffers.

import ExcelJS from 'exceljs'
import { PDFDocument } from 'pdf-lib'
import type { PDFForm } from 'pdf-lib'
import { chat, resolveMediaModelForUser } from '@/lib/platform/llm-gateway'
import { mediaPartFromBytes } from '@/lib/platform/media'

/** Where a document tool reads and writes bytes. */
export interface DocFileIO {
  /** Read a file from the user's desktop. Throws with a readable message. */
  readDesktopFile(path: string): Promise<Buffer>
  /** Write a file to the user's desktop. Throws with a readable message. */
  writeDesktopFile(path: string, bytes: Buffer): Promise<void>
  /** Read a previously uploaded asset. Null when it doesn't exist. */
  readAsset(assetId: string): Promise<{ bytes: Buffer; name: string } | null>
  /** Persist bytes as a downloadable asset. */
  writeAsset(name: string, bytes: Buffer, mimeType: string): Promise<{ id: string; url: string }>
  /** Fetch a URL (bounded). Throws with a readable message. */
  fetchUrl(url: string): Promise<{ bytes: Buffer; name: string }>
}

/** How a document tool was pointed at its input. Exactly one must be set. */
export interface DocSource {
  path?: string
  assetId?: string
  url?: string
}

export interface LoadedDoc {
  bytes: Buffer
  name: string
  /** Human-readable description of where it came from, for display strings. */
  origin: string
}

const MAX_URL_BYTES = 20 * 1024 * 1024

export function describeSource(src: DocSource): string {
  return src.path ?? src.assetId ?? src.url ?? '(none)'
}

/** Resolve a path/assetId/url into bytes. Throws a user-readable Error. */
export async function loadDoc(src: DocSource, io: DocFileIO): Promise<LoadedDoc> {
  const given = [src.path, src.assetId, src.url].filter(Boolean)
  if (given.length === 0) {
    throw new Error('Give one of: path (a file on the desktop), assetId, or url.')
  }
  if (given.length > 1) {
    throw new Error('Give exactly one of path, assetId, or url — not several.')
  }
  if (src.path) {
    const bytes = await io.readDesktopFile(src.path)
    return { bytes, name: basename(src.path), origin: src.path }
  }
  if (src.assetId) {
    const asset = await io.readAsset(src.assetId)
    if (!asset) throw new Error(`Asset ${src.assetId} not found.`)
    return { bytes: asset.bytes, name: asset.name, origin: asset.name }
  }
  const fetched = await io.fetchUrl(src.url!)
  return { bytes: fetched.bytes, name: fetched.name, origin: src.url! }
}

export function basename(p: string): string {
  return p.split(/[/\\]/).filter(Boolean).pop() ?? p
}

export { MAX_URL_BYTES }

// ---------------- doc_extract ----------------

export interface DocExtractInput extends DocSource {
  /** Field names to pull out, e.g. ["full_name", "date_of_birth", "member_id"]. */
  fields?: string[]
  /** Extra guidance: what the document is, how to disambiguate, formats. */
  instructions?: string
  /** Also return the document's full readable text. Defaults true. */
  includeText?: boolean
  /** Model id hint; must be vision-capable or it is ignored. */
  model?: string
}

export interface DocExtractResult {
  documentType: string
  fields: Record<string, string | null>
  text?: string
  confidence: number
  notes?: string
  modelId: string
}

function extractionPrompt(input: DocExtractInput, name: string): string {
  const wanted = input.fields?.length
    ? `Extract exactly these fields: ${input.fields.join(', ')}.\n` +
      `Use null for any field that is genuinely not present. Do NOT guess.\n`
    : `Extract every clearly labelled field you find, using snake_case keys.\n`

  return (
    `You are reading a scanned or digital document named "${name}".\n\n` +
    wanted +
    (input.instructions ? `\nContext from the operator: ${input.instructions}\n` : '') +
    `\nReturn ONLY a JSON object, no prose and no code fence, shaped:\n` +
    `{\n` +
    `  "documentType": "a short label, e.g. drivers_license, pay_stub, invoice",\n` +
    `  "fields": { "field_name": "value or null" },\n` +
    (input.includeText === false ? '' : `  "text": "the document's full readable text",\n`) +
    `  "confidence": 0.0-1.0 — how sure you are the values are right,\n` +
    `  "notes": "anything unreadable, ambiguous, or worth a human's eyes (omit if none)"\n` +
    `}\n\n` +
    `Rules: transcribe values exactly as printed — do not reformat dates, ` +
    `normalize names, or expand abbreviations. If the scan is too poor to read ` +
    `a value, use null and say so in notes. Report low confidence honestly; a ` +
    `wrong value is worse than a flagged one.`
  )
}

/** Strip a ```json fence if the model added one despite being told not to. */
function parseJsonLoose(raw: string): Record<string, unknown> | null {
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
  try {
    const parsed = JSON.parse(cleaned)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    // The model may have wrapped the object in prose — take the outermost braces.
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>
    } catch {
      return null
    }
  }
}

/**
 * Read a document into structured fields using a vision-capable model.
 *
 * This is the real extraction path: the page bytes go to the model as an image
 * or a PDF document block, not as a filename. No OCR engine to install.
 */
export async function extractDocument(
  userId: string,
  input: DocExtractInput,
  io: DocFileIO,
  opts: { refId?: string } = {},
): Promise<DocExtractResult> {
  const doc = await loadDoc(input, io)
  const built = await mediaPartFromBytes(doc.bytes, doc.name)
  if ('error' in built) throw new Error(built.error)
  const part = built.part

  const picked = await resolveMediaModelForUser(userId, {
    needsDocuments: part.kind === 'document',
    hint: input.model,
  })
  if (!picked) {
    throw new Error(
      part.kind === 'document'
        ? 'No PDF-capable model is configured. Connect an Anthropic or Google provider, or convert the page to a PNG/JPEG first.'
        : 'No vision-capable model is configured for this account.',
    )
  }

  const res = await chat({
    modelId: picked.modelId,
    userId,
    source: 'reason',
    refId: opts.refId,
    maxTokens: 4096,
    temperature: 0,
    thinking: false,
    messages: [
      {
        role: 'user',
        content: extractionPrompt(input, doc.name),
        media: [part],
      },
    ],
  })

  const parsed = parseJsonLoose(res.content)
  if (!parsed) {
    throw new Error(`The model did not return usable JSON: ${res.content.slice(0, 300)}`)
  }

  const rawFields = (parsed.fields ?? {}) as Record<string, unknown>
  const fields: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(rawFields)) {
    fields[k] = v === null || v === undefined || v === '' ? null : String(v)
  }
  // Requested-but-absent fields come back explicitly null, so downstream steps
  // can branch on "missing" without guessing whether the model just forgot.
  for (const f of input.fields ?? []) {
    if (!(f in fields)) fields[f] = null
  }

  const confidence = Number(parsed.confidence)
  return {
    documentType: String(parsed.documentType ?? 'unknown'),
    fields,
    text: typeof parsed.text === 'string' ? parsed.text : undefined,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0,
    notes: typeof parsed.notes === 'string' && parsed.notes ? parsed.notes : undefined,
    modelId: picked.modelId,
  }
}

// ---------------- PDF forms ----------------

export interface PdfFieldInfo {
  name: string
  type: 'text' | 'checkbox' | 'dropdown' | 'radio' | 'optionlist' | 'button' | 'signature' | 'unknown'
  value?: string | string[] | boolean
  options?: string[]
  readOnly: boolean
}

function fieldType(ctorName: string): PdfFieldInfo['type'] {
  switch (ctorName) {
    case 'PDFTextField':
      return 'text'
    case 'PDFCheckBox':
      return 'checkbox'
    case 'PDFDropdown':
      return 'dropdown'
    case 'PDFRadioGroup':
      return 'radio'
    case 'PDFOptionList':
      return 'optionlist'
    case 'PDFButton':
      return 'button'
    case 'PDFSignature':
      return 'signature'
    default:
      return 'unknown'
  }
}

function readField(form: PDFForm, name: string, type: PdfFieldInfo['type']): PdfFieldInfo {
  const info: PdfFieldInfo = { name, type, readOnly: false }
  try {
    switch (type) {
      case 'text': {
        const f = form.getTextField(name)
        info.value = f.getText() ?? ''
        info.readOnly = f.isReadOnly()
        break
      }
      case 'checkbox': {
        const f = form.getCheckBox(name)
        info.value = f.isChecked()
        info.readOnly = f.isReadOnly()
        break
      }
      case 'dropdown': {
        const f = form.getDropdown(name)
        info.value = f.getSelected()
        info.options = f.getOptions()
        info.readOnly = f.isReadOnly()
        break
      }
      case 'radio': {
        const f = form.getRadioGroup(name)
        info.value = f.getSelected() ?? ''
        info.options = f.getOptions()
        info.readOnly = f.isReadOnly()
        break
      }
      case 'optionlist': {
        const f = form.getOptionList(name)
        info.value = f.getSelected()
        info.options = f.getOptions()
        info.readOnly = f.isReadOnly()
        break
      }
      default:
        break
    }
  } catch {
    // A malformed field shouldn't hide the rest of the form.
  }
  return info
}

/** List the fillable fields on a PDF's AcroForm, with their current values. */
export async function readPdfFormFields(bytes: Buffer): Promise<PdfFieldInfo[]> {
  const pdf = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
  const form = pdf.getForm()
  return form.getFields().map((f) => {
    const name = f.getName()
    return readField(form, name, fieldType(f.constructor.name))
  })
}

export interface PdfFillOutcome {
  filled: string[]
  skipped: Array<{ name: string; reason: string }>
  bytes: Buffer
}

/** True-ish parsing for checkbox values coming from a model or a spreadsheet. */
function truthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  return s === 'true' || s === 'yes' || s === 'y' || s === '1' || s === 'on' || s === 'x' || s === 'checked'
}

/**
 * Fill an AcroForm. Unknown field names are reported, never silently dropped —
 * a form that quietly half-fills is worse than one that says what it missed.
 */
export async function fillPdfForm(
  bytes: Buffer,
  values: Record<string, unknown>,
  opts: { flatten?: boolean } = {},
): Promise<PdfFillOutcome> {
  const pdf = await PDFDocument.load(new Uint8Array(bytes), { ignoreEncryption: true })
  const form = pdf.getForm()
  const known = new Map(form.getFields().map((f) => [f.getName(), fieldType(f.constructor.name)]))

  const filled: string[] = []
  const skipped: Array<{ name: string; reason: string }> = []

  for (const [name, raw] of Object.entries(values)) {
    const type = known.get(name)
    if (!type) {
      skipped.push({ name, reason: 'no field with that name — call pdf_form_fields to see the real names' })
      continue
    }
    try {
      switch (type) {
        case 'text':
          form.getTextField(name).setText(raw == null ? '' : String(raw))
          break
        case 'checkbox': {
          const box = form.getCheckBox(name)
          if (truthy(raw)) box.check()
          else box.uncheck()
          break
        }
        case 'dropdown': {
          const dd = form.getDropdown(name)
          const options = dd.getOptions()
          const wanted = String(raw)
          const match = options.find((o) => o.toLowerCase() === wanted.toLowerCase())
          if (!match) {
            skipped.push({ name, reason: `"${wanted}" is not an option (${options.join(' | ')})` })
            continue
          }
          dd.select(match)
          break
        }
        case 'radio': {
          const rg = form.getRadioGroup(name)
          const options = rg.getOptions()
          const wanted = String(raw)
          const match = options.find((o) => o.toLowerCase() === wanted.toLowerCase())
          if (!match) {
            skipped.push({ name, reason: `"${wanted}" is not an option (${options.join(' | ')})` })
            continue
          }
          rg.select(match)
          break
        }
        case 'optionlist': {
          const ol = form.getOptionList(name)
          const wanted = Array.isArray(raw) ? raw.map(String) : [String(raw)]
          ol.select(wanted)
          break
        }
        default:
          skipped.push({ name, reason: `${type} fields cannot be filled programmatically` })
          continue
      }
      filled.push(name)
    } catch (e) {
      skipped.push({ name, reason: (e as Error).message })
    }
  }

  // Flattening bakes the values into the page — the right default for a form
  // that's about to be submitted, so a recipient can't edit it back.
  if (opts.flatten) form.flatten()

  const out = await pdf.save()
  return { filled, skipped, bytes: Buffer.from(out) }
}

// ---------------- Spreadsheets ----------------

export type SheetRow = Record<string, unknown>

export interface SheetAppendOutcome {
  bytes: Buffer
  headers: string[]
  appended: number
  totalRows: number
  createdFile: boolean
  createdSheet: boolean
}

export function isCsvName(name: string): boolean {
  return /\.csv$/i.test(name)
}

function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Minimal RFC-4180 parse — enough for the sheets these workflows produce. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else quoted = false
      } else cell += c
      continue
    }
    if (c === '"') quoted = true
    else if (c === ',') {
      row.push(cell)
      cell = ''
    } else if (c === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else if (c !== '\r') cell += c
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((v) => v !== ''))
}

function normalizeRows(rows: unknown): SheetRow[] {
  if (!Array.isArray(rows)) throw new Error('rows must be an array of objects')
  return rows.map((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      throw new Error(`rows[${i}] must be an object of column → value`)
    }
    return r as SheetRow
  })
}

/** Append rows to an existing CSV (or create one), keeping the header stable. */
export function appendCsv(existing: Buffer | null, rowsInput: unknown): SheetAppendOutcome {
  const rows = normalizeRows(rowsInput)
  const parsed = existing ? parseCsv(existing.toString('utf8')) : []
  const createdFile = parsed.length === 0
  const headers = createdFile ? [] : parsed[0].slice()

  for (const r of rows) {
    for (const k of Object.keys(r)) if (!headers.includes(k)) headers.push(k)
  }

  const body = parsed.slice(1)
  const out: string[] = [headers.map(csvEscape).join(',')]
  for (const line of body) {
    // Re-emit prior rows against the (possibly widened) header.
    const padded = headers.map((_, i) => line[i] ?? '')
    out.push(padded.map(csvEscape).join(','))
  }
  for (const r of rows) {
    out.push(headers.map((h) => csvEscape(r[h])).join(','))
  }

  return {
    bytes: Buffer.from(out.join('\n') + '\n', 'utf8'),
    headers,
    appended: rows.length,
    totalRows: body.length + rows.length,
    createdFile,
    createdSheet: createdFile,
  }
}

/**
 * Append rows to an .xlsx workbook, creating the file and/or the worksheet if
 * they don't exist. New columns are added to the header rather than dropped.
 */
export async function appendXlsx(
  existing: Buffer | null,
  rowsInput: unknown,
  opts: { sheetName?: string } = {},
): Promise<SheetAppendOutcome> {
  const rows = normalizeRows(rowsInput)
  const wb = new ExcelJS.Workbook()
  let createdFile = false
  if (existing) {
    await wb.xlsx.load(new Uint8Array(existing) as unknown as ArrayBuffer)
  } else {
    createdFile = true
  }

  const sheetName = opts.sheetName?.trim() || undefined
  let ws = sheetName ? wb.getWorksheet(sheetName) : wb.worksheets[0]
  let createdSheet = false
  if (!ws) {
    ws = wb.addWorksheet(sheetName ?? 'Sheet1')
    createdSheet = true
  }

  const headerRow = ws.getRow(1)
  const headers: string[] = []
  if (!createdSheet && headerRow.cellCount > 0) {
    headerRow.eachCell({ includeEmpty: true }, (cell) => {
      headers.push(cell.value == null ? '' : String(cell.value))
    })
  }
  const before = headers.length > 0 ? Math.max(0, ws.rowCount - 1) : 0

  let headerChanged = headers.length === 0
  for (const r of rows) {
    for (const k of Object.keys(r)) {
      if (!headers.includes(k)) {
        headers.push(k)
        headerChanged = true
      }
    }
  }
  if (headerChanged) {
    ws.getRow(1).values = headers
    ws.getRow(1).font = { bold: true }
    ws.getRow(1).commit()
  }

  for (const r of rows) {
    ws.addRow(headers.map((h) => cellValue(r[h])))
  }

  const out = await wb.xlsx.writeBuffer()
  return {
    bytes: Buffer.from(out),
    headers,
    appended: rows.length,
    totalRows: before + rows.length,
    createdFile,
    createdSheet,
  }
}

/** Keep dates/numbers as real cell types; everything else becomes text. */
function cellValue(v: unknown): string | number | Date | null {
  if (v == null || v === '') return null
  if (typeof v === 'number' || v instanceof Date) return v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  return String(v)
}

export interface SheetReadResult {
  headers: string[]
  rows: SheetRow[]
  totalRows: number
  sheetNames: string[]
}

/** Read rows out of an .xlsx or .csv as objects keyed by the header row. */
export async function readSheet(
  bytes: Buffer,
  name: string,
  opts: { sheetName?: string; limit?: number } = {},
): Promise<SheetReadResult> {
  const limit = Math.min(2000, Math.max(1, opts.limit ?? 200))

  if (isCsvName(name)) {
    const grid = parseCsv(bytes.toString('utf8'))
    const headers = grid[0] ?? []
    const body = grid.slice(1)
    const rows = body.slice(0, limit).map((line) => {
      const r: SheetRow = {}
      headers.forEach((h, i) => (r[h] = line[i] ?? ''))
      return r
    })
    return { headers, rows, totalRows: body.length, sheetNames: [] }
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(new Uint8Array(bytes) as unknown as ArrayBuffer)
  const sheetNames = wb.worksheets.map((w) => w.name)
  const ws = opts.sheetName ? wb.getWorksheet(opts.sheetName) : wb.worksheets[0]
  if (!ws) {
    throw new Error(
      opts.sheetName
        ? `No sheet named "${opts.sheetName}". Sheets: ${sheetNames.join(', ') || '(none)'}`
        : 'The workbook has no sheets.',
    )
  }

  const headers: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    headers.push(cell.value == null ? '' : String(cell.value))
  })

  const rows: SheetRow[] = []
  const totalRows = Math.max(0, ws.rowCount - 1)
  for (let i = 2; i <= ws.rowCount && rows.length < limit; i++) {
    const row = ws.getRow(i)
    const r: SheetRow = {}
    let any = false
    headers.forEach((h, idx) => {
      const cell = row.getCell(idx + 1)
      const v = cell.value
      const text = v == null ? '' : typeof v === 'object' && 'text' in v ? String(v.text) : String(v)
      if (text !== '') any = true
      r[h] = text
    })
    if (any) rows.push(r)
  }

  return { headers, rows, totalRows, sheetNames }
}
