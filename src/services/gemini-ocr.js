/**
 * Gemini Vision — via Cloudflare Worker proxy.
 *
 * Two modes:
 *
 * processWithGemini(image, targetLang, onProgress)
 *   PRIMARY — OCR + translation in a single Gemini call.
 *   Gemini reads the entire image and translates with full document context.
 *   Returns the final translated text directly.
 *
 * extractTextWithGemini(image, onProgress)
 *   FALLBACK — OCR only. Used when translation is handled separately
 *   (e.g. PDF native text path).
 *
 * Both fall back to Tesseract + Google Translate when the Worker is
 * unavailable, quota exceeded, or the API key is not configured.
 */

const WORKER_URL = import.meta.env.VITE_GEMINI_WORKER_URL || null

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function postToWorker(endpoint, body, signal) {
  const res = await fetch(WORKER_URL + endpoint, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  signal || AbortSignal.timeout(45000),
  })
  const data = await res.json()
  if (!res.ok) {
    const msg = data.error || `HTTP ${res.status}`
    if (res.status === 429 || res.status >= 500) throw new Error('GEMINI_UNAVAILABLE: ' + msg)
    throw new Error('GEMINI_ERROR: ' + msg)
  }
  if (!data.text?.trim()) throw new Error('GEMINI_EMPTY_RESPONSE')
  return data.text
}

/**
 * PRIMARY path: OCR + translation in one Gemini call.
 * targetLang = { code: 'fr', name: 'French', nameFr: 'Français', ... }
 */
export async function processWithGemini(imageBlob, targetLang, onProgress) {
  if (!WORKER_URL) throw new Error('GEMINI_KEY_MISSING')

  onProgress?.(10)
  const base64   = await blobToBase64(imageBlob)
  const mimeType = imageBlob.type || 'image/jpeg'
  onProgress?.(20)

  const text = await postToWorker('/process', {
    image:          base64,
    mimeType,
    targetLang:     targetLang.code,
    targetLangName: targetLang.nameFr || targetLang.name,
  })

  onProgress?.(100)
  return text
}

/**
 * FALLBACK path: OCR only (for native PDF text extraction context).
 */
export async function extractTextWithGemini(imageBlob, onProgress) {
  if (!WORKER_URL) throw new Error('GEMINI_KEY_MISSING')

  onProgress?.(10)
  const base64   = await blobToBase64(imageBlob)
  const mimeType = imageBlob.type || 'image/jpeg'
  onProgress?.(20)

  const text = await postToWorker('/ocr', { image: base64, mimeType })
  onProgress?.(100)
  return text
}

export function isGeminiAvailable() {
  return !!WORKER_URL
}
