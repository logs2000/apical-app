// Media normalization for multimodal turns.
//
// The gateway speaks in `MediaPart` (kind + mimeType + base64). This module is
// the single place that decides what counts as readable media, what MIME type
// a file actually has, and how big a part may get before it costs more than
// it's worth. Both the agent engine (user attachments on a chat turn) and the
// doc_extract tool (a scan pulled off the desktop) go through it.

import sharp from 'sharp'
import { readAssetBytes, getUserAsset } from '@/lib/platform/assets'
import type { MediaPart } from '@/lib/platform/llm-gateway'

/** Per-part ceiling. Anthropic caps requests around 32MB total; stay well under. */
export const MAX_MEDIA_BYTES = 10 * 1024 * 1024
/** Anthropic's optimal long side; other providers accept it fine. */
const MAX_LONG_SIDE = 1568
/** Post-encode cap for images, well under every provider's payload limit. */
const MAX_ENCODED_BYTES = 3_500_000
/** How many attachments ride along on a single chat turn. */
export const MAX_TURN_MEDIA_PARTS = 6

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
}

/**
 * The MIME type to actually send. Uploads routinely arrive as
 * application/octet-stream (Tauri's picker sets no type), so the extension is
 * the more reliable signal for the formats we care about.
 */
export function normalizeMediaMime(mimeType: string | undefined, name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (IMAGE_MIME_BY_EXT[ext]) return IMAGE_MIME_BY_EXT[ext]
  if (ext === 'pdf') return 'application/pdf'
  const mt = (mimeType ?? '').toLowerCase()
  if (mt.startsWith('image/') || mt === 'application/pdf') return mt
  return mt || 'application/octet-stream'
}

/** How the model should receive this file, or null when it can't read it at all. */
export function mediaKindFor(mimeType: string, name: string): MediaPart['kind'] | null {
  const mt = normalizeMediaMime(mimeType, name)
  if (mt === 'application/pdf') return 'document'
  if (Object.values(IMAGE_MIME_BY_EXT).includes(mt)) return 'image'
  return null
}

/** True when this file is something a vision model can be handed directly. */
export function isReadableMedia(mimeType: string, name: string): boolean {
  return mediaKindFor(mimeType, name) !== null
}

/**
 * Downscale + re-encode an image so it stays inside provider limits and
 * doesn't cost a fortune in tokens. A phone photo of an ID card is routinely
 * 4000px and 8MB; at 1568px it reads just as well for a fraction of the
 * price. PNGs with transparency stay PNG, everything else becomes JPEG.
 */
async function normalizeImageBytes(
  bytes: Buffer,
  name: string,
): Promise<{ data: Buffer; mimeType: string } | { error: string }> {
  try {
    let img = sharp(bytes, { failOn: 'error' })
    const meta = await img.metadata()
    if (!meta.width || !meta.height) return { error: `${name} is not a decodable image.` }

    if (Math.max(meta.width, meta.height) > MAX_LONG_SIDE) {
      img = img.resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: 'inside' })
    }

    const keepPng = meta.format === 'png' && meta.hasAlpha === true
    let mimeType = keepPng ? 'image/png' : 'image/jpeg'
    let out = keepPng
      ? await img.png({ compressionLevel: 9 }).toBuffer()
      : await img.jpeg({ quality: 80 }).toBuffer()

    // Rare oversize survivors (very large PNGs) get one more JPEG pass.
    if (out.length > MAX_ENCODED_BYTES) {
      out = await sharp(out).jpeg({ quality: 60 }).toBuffer()
      mimeType = 'image/jpeg'
    }
    if (out.length > MAX_ENCODED_BYTES) {
      return { error: `${name} is still too large after re-encoding.` }
    }
    return { data: out, mimeType }
  } catch (e) {
    return { error: `Could not read ${name} as an image: ${(e as Error).message}` }
  }
}

/**
 * Build a MediaPart from raw bytes, or an error explaining why we can't.
 *
 * Images are downscaled and re-encoded; PDFs pass through untouched, because
 * re-encoding a PDF would lose the text layer the model reads from.
 */
export async function mediaPartFromBytes(
  bytes: Buffer,
  name: string,
  mimeType?: string,
): Promise<{ part: MediaPart } | { error: string }> {
  const mt = normalizeMediaMime(mimeType, name)
  const kind = mediaKindFor(mt, name)
  if (!kind) {
    return {
      error: `${name} is ${mt} — not an image or PDF. Read it with fs_read and parse the text instead.`,
    }
  }

  if (kind === 'image') {
    const normalized = await normalizeImageBytes(bytes, name)
    if ('error' in normalized) return normalized
    return {
      part: {
        kind,
        mimeType: normalized.mimeType,
        data: normalized.data.toString('base64'),
        name,
      },
    }
  }

  if (bytes.length > MAX_MEDIA_BYTES) {
    return {
      error: `${name} is ${(bytes.length / 1024 / 1024).toFixed(1)}MB — over the ${MAX_MEDIA_BYTES / 1024 / 1024}MB limit. Split it into fewer pages first.`,
    }
  }
  return { part: { kind, mimeType: mt, data: bytes.toString('base64'), name } }
}

/** Load an uploaded asset as a MediaPart. Returns null for anything unreadable. */
export async function mediaPartFromAsset(
  userId: string,
  assetId: string,
): Promise<MediaPart | null> {
  const row = await getUserAsset(userId, assetId)
  if (!row || row.kind === 'folder') return null
  if (!isReadableMedia(row.mimeType, row.name)) return null
  const bytes = await readAssetBytes(userId, assetId)
  if (!bytes) return null
  const built = await mediaPartFromBytes(bytes, row.name, row.mimeType)
  return 'part' in built ? built.part : null
}

/**
 * Turn a turn's chat attachments into media parts. Attachments that are folder
 * refs, desktop path refs with no uploaded bytes, or non-visual files are
 * skipped — they stay described in the prompt text and the agent reaches them
 * with fs_read / doc_extract instead.
 */
export async function mediaPartsForAttachments(
  userId: string,
  attachments: Array<{ id: string; name: string; mimeType: string; kind: string }> | undefined,
): Promise<MediaPart[]> {
  if (!attachments?.length) return []
  const candidates = attachments
    .filter((a) => a.kind !== 'folder' && isReadableMedia(a.mimeType, a.name))
    .slice(0, MAX_TURN_MEDIA_PARTS)
  const parts: MediaPart[] = []
  for (const a of candidates) {
    const part = await mediaPartFromAsset(userId, a.id).catch(() => null)
    if (part) parts.push(part)
  }
  return parts
}
