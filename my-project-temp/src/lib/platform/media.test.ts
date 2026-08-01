import { describe, expect, test } from 'bun:test'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'
import {
  isReadableMedia,
  mediaKindFor,
  mediaPartFromBytes,
  normalizeMediaMime,
} from './media'

async function jpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#888' } })
    .jpeg()
    .toBuffer()
}

async function pdfBytes(): Promise<Buffer> {
  const doc = await PDFDocument.create()
  doc.addPage()
  return Buffer.from(await doc.save())
}

describe('mime normalization', () => {
  test('trusts the extension over an octet-stream type', () => {
    // Tauri's file picker sets no MIME type, so uploads arrive like this.
    expect(normalizeMediaMime('application/octet-stream', 'scan.pdf')).toBe('application/pdf')
    expect(normalizeMediaMime('application/octet-stream', 'id.JPG')).toBe('image/jpeg')
    expect(normalizeMediaMime(undefined, 'x.png')).toBe('image/png')
  })

  test('classifies what a vision model can and cannot read', () => {
    expect(mediaKindFor('application/pdf', 'a.pdf')).toBe('document')
    expect(mediaKindFor('image/png', 'a.png')).toBe('image')
    expect(mediaKindFor('text/csv', 'a.csv')).toBeNull()
    expect(isReadableMedia('application/msword', 'a.doc')).toBe(false)
  })
})

describe('mediaPartFromBytes', () => {
  test('downscales an oversize photo to the 1568px long side', async () => {
    const big = await jpeg(4000, 3000)
    const built = await mediaPartFromBytes(big, 'id-scan.jpg')
    if ('error' in built) throw new Error(built.error)

    const out = Buffer.from(built.part.data, 'base64')
    const meta = await sharp(out).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBe(1568)
    expect(out.length).toBeLessThan(big.length)
    expect(built.part.kind).toBe('image')
  })

  test('leaves an already-small image at its original dimensions', async () => {
    const small = await jpeg(800, 600)
    const built = await mediaPartFromBytes(small, 'small.jpg')
    if ('error' in built) throw new Error(built.error)
    const meta = await sharp(Buffer.from(built.part.data, 'base64')).metadata()
    expect(meta.width).toBe(800)
    expect(meta.height).toBe(600)
  })

  test('passes a PDF through byte-identical as a document', async () => {
    // Re-encoding a PDF would destroy the text layer the model reads from.
    const pdf = await pdfBytes()
    const built = await mediaPartFromBytes(pdf, 'form.pdf')
    if ('error' in built) throw new Error(built.error)
    expect(built.part.kind).toBe('document')
    expect(built.part.mimeType).toBe('application/pdf')
    expect(Buffer.from(built.part.data, 'base64').equals(pdf)).toBe(true)
  })

  test('explains why an unsupported type cannot be read', async () => {
    const built = await mediaPartFromBytes(Buffer.from('col1,col2\n1,2'), 'data.csv')
    expect('error' in built).toBe(true)
    if ('error' in built) expect(built.error).toContain('fs_read')
  })

  test('rejects bytes that are not a decodable image', async () => {
    const built = await mediaPartFromBytes(Buffer.from('not an image at all'), 'broken.png')
    expect('error' in built).toBe(true)
  })
})
