// Image normalization for vision input. Everything that becomes an
// ImagePart flows through here so provider payloads stay bounded:
// resize to a sane long side, re-encode, and hard-cap the byte size.

import sharp from 'sharp'
import type { ImagePart } from './llm-gateway'
import { readAssetBytes } from './assets'
import { getObject } from './storage'

/** Anthropic's optimal ceiling; other providers accept it fine. */
const MAX_LONG_SIDE = 1568
/** Post-encode cap — stays well under provider payload limits. */
const MAX_ENCODED_BYTES = 3_500_000
const FETCH_TIMEOUT_MS = 20_000
const MAX_FETCH_BYTES = 30_000_000

export interface NormalizeImageInput {
  /** UserAsset id (requires userId). */
  assetId?: string
  userId?: string
  /** http(s) or data: URL. */
  url?: string
  /** Raw bytes (already in hand — screenshots, job artifacts). */
  bytes?: Buffer
  /** storage.ts storageKey ("sb:..." or local relative key). */
  storageKey?: string
  label?: string
}

export interface NormalizedImage extends ImagePart {
  width: number
  height: number
  /** Bytes of the encoded (post-resize) image. */
  sizeBytes: number
}

async function fetchUrlBytes(url: string): Promise<Buffer> {
  if (url.startsWith('data:')) {
    const comma = url.indexOf(',')
    if (comma < 0) throw new Error('malformed data: URL')
    const meta = url.slice(5, comma)
    const data = url.slice(comma + 1)
    return meta.includes('base64') ? Buffer.from(data, 'base64') : Buffer.from(decodeURIComponent(data))
  }
  if (!/^https?:\/\//i.test(url)) throw new Error('image url must be http(s) or data:')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { signal: ctrl.signal, redirect: 'follow' })
    if (!res.ok) throw new Error(`image fetch failed: HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    if (buf.length > MAX_FETCH_BYTES) throw new Error(`image too large (${buf.length} bytes)`)
    return buf
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Load + downscale + re-encode an image into a model-ready ImagePart.
 * Throws with a user-readable message when the source is missing or not an
 * image. PNGs with transparency stay PNG; everything else becomes JPEG q80.
 */
export async function normalizeImage(input: NormalizeImageInput): Promise<NormalizedImage> {
  let bytes: Buffer | null = null
  if (input.bytes) bytes = input.bytes
  else if (input.storageKey) bytes = await getObject(input.storageKey)
  else if (input.assetId) {
    if (!input.userId) throw new Error('assetId requires userId')
    bytes = await readAssetBytes(input.userId, input.assetId)
  } else if (input.url) bytes = await fetchUrlBytes(input.url)
  if (!bytes || bytes.length === 0) throw new Error('image source is empty or unreadable')

  let img = sharp(bytes, { failOn: 'error' })
  const meta = await img.metadata().catch(() => null)
  if (!meta?.width || !meta.height) throw new Error('not a decodable image')

  if (Math.max(meta.width, meta.height) > MAX_LONG_SIDE) {
    img = img.resize({ width: MAX_LONG_SIDE, height: MAX_LONG_SIDE, fit: 'inside' })
  }

  const keepPng = meta.format === 'png' && meta.hasAlpha === true
  let format: 'image/png' | 'image/jpeg' = keepPng ? 'image/png' : 'image/jpeg'
  let out = keepPng
    ? await img.png({ compressionLevel: 9 }).toBuffer({ resolveWithObject: true })
    : await img.jpeg({ quality: 80 }).toBuffer({ resolveWithObject: true })

  // Rare oversize survivors (huge PNGs) get one JPEG re-encode pass.
  if (out.data.length > MAX_ENCODED_BYTES) {
    out = await sharp(out.data).jpeg({ quality: 60 }).toBuffer({ resolveWithObject: true })
    format = 'image/jpeg'
  }
  if (out.data.length > MAX_ENCODED_BYTES) {
    throw new Error('image exceeds size budget even after re-encoding')
  }

  return {
    mimeType: format,
    base64: out.data.toString('base64'),
    label: input.label,
    width: out.info.width,
    height: out.info.height,
    sizeBytes: out.data.length,
  }
}
