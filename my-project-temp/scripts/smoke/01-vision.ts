// Smoke: multimodal message conversion per provider + vision strip + image normalization.
// Pure functions — no network, no DB. Run: bun scripts/smoke/01-vision.ts

import {
  toOpenAIMessages,
  toAnthropicMessages,
  toGoogleContents,
  toOllamaMessages,
  stripImagesFromMessages,
  type GatewayMessage,
} from '../../src/lib/platform/llm-gateway'
import { normalizeImage } from '../../src/lib/platform/images'
import sharp from 'sharp'

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) {
    console.error(`FAIL: ${msg}`)
    process.exit(1)
  }
}

const img = { mimeType: 'image/jpeg', base64: 'aGVsbG8=', label: 'test shot' }
const messages: GatewayMessage[] = [
  { role: 'system', content: 'sys' },
  { role: 'user', content: 'look at this', images: [img] },
  { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: 'image_read', arguments: {} }] },
  { role: 'tool', toolCallId: 'c1', name: 'image_read', content: '{"ok":true}', images: [img] },
]

// OpenAI: user content array with image_url; tool images ride a synthetic user turn.
const oa = toOpenAIMessages(messages)
const oaUser = oa[1] as { content: Array<{ type: string; image_url?: { url: string } }> }
assert(Array.isArray(oaUser.content), 'openai user content should be an array')
assert(
  oaUser.content.some((p) => p.type === 'image_url' && p.image_url?.url.startsWith('data:image/jpeg;base64,')),
  'openai user missing image_url part',
)
const oaSynth = oa[4] as { role: string; content: Array<{ type: string }> }
assert(oa.length === 5 && oaSynth.role === 'user' && oaSynth.content.some((p) => p.type === 'image_url'), 'openai tool images must emit a synthetic user turn')

// Anthropic: image blocks inside user content and tool_result content.
const an = toAnthropicMessages(messages)
const anUser = an[0] as { content: Array<{ type: string }> }
assert(Array.isArray(anUser.content) && anUser.content.some((b) => b.type === 'image'), 'anthropic user missing image block')
const anToolTurn = an[2] as { content: Array<{ type: string; content?: Array<{ type: string }> }> }
const toolResult = anToolTurn.content.find((b) => b.type === 'tool_result')
assert(toolResult && Array.isArray(toolResult.content) && toolResult.content.some((b) => b.type === 'image'), 'anthropic tool_result missing image block')

// Google: inlineData parts; tool images in a follow-up user turn.
const go = toGoogleContents(messages)
const goUser = go[0] as { parts: Array<{ inlineData?: { mimeType: string } }> }
assert(goUser.parts.some((p) => p.inlineData?.mimeType === 'image/jpeg'), 'google user missing inlineData')
assert(go.length === 4 && (go[3] as { parts: Array<{ inlineData?: unknown }> }).parts.some((p) => p.inlineData), 'google tool images must emit a follow-up user turn')

// Ollama: base64 images array on the message.
const ol = toOllamaMessages(messages)
assert(((ol[1] as { images?: string[] }).images ?? [])[0] === 'aGVsbG8=', 'ollama user missing images array')

// Strip pass: images removed, note appended.
const stripped = stripImagesFromMessages(messages)
assert(!(stripped[1] as { images?: unknown }).images, 'strip must remove images')
assert((stripped[1] as { content: string }).content.includes('omitted'), 'strip must leave a note')
assert((stripped[3] as { content: string }).content.includes('test shot'), 'strip note should carry the label')

// normalizeImage: generate a 3000px PNG, expect downscale to <=1568 JPEG.
const bigPng = await sharp({
  create: { width: 3000, height: 1500, channels: 3, background: { r: 200, g: 30, b: 40 } },
}).png().toBuffer()
const norm = await normalizeImage({ bytes: bigPng, label: 'big' })
assert(norm.width === 1568, `expected width 1568, got ${norm.width}`)
assert(norm.mimeType === 'image/jpeg', `expected jpeg, got ${norm.mimeType}`)
assert(norm.base64.length > 0 && norm.sizeBytes < 3_500_000, 'normalized image out of budget')

console.log('OK: 01-vision')
