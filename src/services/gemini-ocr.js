/**
 * Gemini Vision OCR — via Cloudflare Worker proxy.
 *
 * The Gemini API key lives in the Worker (server-side, never in the bundle).
 * The Worker URL is public but harmless without the key.
 *
 * Falls back to Tesseract automatically on Worker errors or quota exceeded.
 */

// Worker URL — set via VITE_GEMINI_WORKER_URL env at build time.
// Default points to the deployed Worker; override in .env for local dev.
const WORKER_URL = import.meta.env.VITE_GEMINI_WORKER_URL || null

/**
 * Convert a Blob/File to base64 string.
 */
async function blobToBase64(blob) {
  // FileReader approach — works back to iOS 7 (unlike blob.arrayBuffer + btoa)
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Extract text from a document image using Gemini via the Cloudflare Worker.
 * Throws GEMINI_UNAVAILABLE if the worker is down or quota is exceeded.
 */
export async function extractTextWithGemini(imageBlob, onProgress) {
  if (!WORKER_URL) throw new Error('GEMINI_KEY_MISSING')

  onProgress?.(15)

  const base64   = await blobToBase64(imageBlob)
  const mimeType = imageBlob.type || 'image/jpeg'

  onProgress?.(25)

  const res = await fetch(WORKER_URL + '/ocr', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: base64, mimeType }),
    signal: AbortSignal.timeout(30000),
  })

  onProgress?.(85)

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    const msg  = body.error || `HTTP ${res.status}`
    if (res.status === 429 || res.status >= 500) {
      throw new Error('GEMINI_UNAVAILABLE: ' + msg)
    }
    throw new Error('GEMINI_ERROR: ' + msg)
  }

  const data = await res.json()
  if (!data.text?.trim()) throw new Error('GEMINI_EMPTY_RESPONSE')

  onProgress?.(100)
  return data.text
}

export function isGeminiAvailable() {
  return !!WORKER_URL
}
