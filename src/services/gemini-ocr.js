/**
 * Gemini services — all via Cloudflare Worker proxy.
 * The API key lives server-side; never in the browser bundle.
 */

const WORKER_URL = import.meta.env.VITE_GEMINI_WORKER_URL || null

// ─── Shared helpers ────────────────────────────────────────────────────────

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

async function postWorker(path, body, timeout = 45000) {
  if (!WORKER_URL) throw new Error('GEMINI_KEY_MISSING')
  const res = await fetch(WORKER_URL + path, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
    signal:  AbortSignal.timeout(timeout),
  })
  if (path === '/tts') {
    if (!res.ok) {
      const d = await res.json().catch(() => ({}))
      throw new Error('GEMINI_UNAVAILABLE: ' + (d.error || `HTTP ${res.status}`))
    }
    return res.blob()  // audio/wav
  }
  const data = await res.json()
  if (!res.ok) {
    const msg = data.error || `HTTP ${res.status}`
    if (res.status === 429 || res.status >= 500) throw new Error('GEMINI_UNAVAILABLE: ' + msg)
    throw new Error('GEMINI_ERROR: ' + msg)
  }
  return data
}

export function isGeminiAvailable() {
  return !!WORKER_URL
}

// ─── 1. OCR + Translation (primary path) ──────────────────────────────────
// Sends the image OR PDF directly to Gemini → one call handles everything.

export async function processWithGemini(imageBlob, targetLang, onProgress) {
  onProgress?.(10)
  const base64   = await blobToBase64(imageBlob)
  const mimeType = imageBlob.type || 'image/jpeg'
  onProgress?.(25)

  const data = await postWorker('/process', {
    image:          base64,
    mimeType,
    targetLangName: targetLang.nameFr || targetLang.name,
  })

  if (!data.text?.trim()) throw new Error('GEMINI_EMPTY_RESPONSE')
  onProgress?.(100)
  return data.text
}

// ─── 2. Image quality check ────────────────────────────────────────────────
// Returns { ok: boolean, issue?: string }
// Fast call — used before processing to give early feedback to the user.

export async function checkImageQuality(imageBlob) {
  if (!WORKER_URL) return { ok: true }
  try {
    const base64   = await blobToBase64(imageBlob)
    const mimeType = imageBlob.type || 'image/jpeg'
    const data     = await postWorker('/check', { image: base64, mimeType }, 15000)
    return { ok: data.ok !== false, issue: data.issue || null }
  } catch {
    return { ok: true }  // don't block on check failure
  }
}

// ─── 3. Document summary ───────────────────────────────────────────────────
// Generates a 2-3 sentence summary of the already-translated text.
// Called after processWithGemini returns, as a non-blocking background task.

export async function summarizeDocument(translatedText, targetLang) {
  if (!WORKER_URL || !translatedText) return null
  try {
    const data = await postWorker('/summarize', {
      text:           translatedText,
      targetLangName: targetLang.nameFr || targetLang.name,
    }, 20000)
    return data.summary || null
  } catch {
    return null  // summary is optional — never block the main flow
  }
}

// ─── 4. Gemini TTS ────────────────────────────────────────────────────────
// Generates audio (WAV blob) from text using Gemini TTS.
// Returns a Blob (audio/wav) or throws GEMINI_UNAVAILABLE on failure.

export async function generateAudioWithGemini(text, lang) {
  if (!WORKER_URL) throw new Error('GEMINI_KEY_MISSING')
  const blob = await postWorker('/tts', { text, lang }, 30000)
  if (!blob || blob.size < 100) throw new Error('GEMINI_UNAVAILABLE: empty audio')
  return blob
}

// ─── OCR-only fallback (for Tesseract fallback path) ──────────────────────

export async function extractTextWithGemini(imageBlob, onProgress) {
  onProgress?.(10)
  const base64   = await blobToBase64(imageBlob)
  const mimeType = imageBlob.type || 'image/jpeg'
  onProgress?.(25)
  const data = await postWorker('/ocr', { image: base64, mimeType })
  if (!data.text?.trim()) throw new Error('GEMINI_EMPTY_RESPONSE')
  onProgress?.(100)
  return data.text
}
