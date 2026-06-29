/**
 * Gemini Vision OCR — replaces Tesseract for image documents.
 *
 * Uses gemini-2.5-flash to extract text from document images with full
 * understanding of document structure (headers, fields, values, mixed scripts).
 * Falls back to Tesseract automatically if Gemini is unavailable or quota exceeded.
 */

const GEMINI_MODEL = 'gemini-2.5-flash'
const GEMINI_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

// Loaded once from the Vite env — set at build time via GitHub Secret
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY

const EXTRACT_PROMPT = `Extract ALL text from this document image.

Rules:
- Preserve the exact content (names, dates, numbers, reference codes)
- Reconstruct fragmented lines: if a title or field value is split across multiple lines, join them
- Keep field labels with their values on the same line (e.g. "Name: BENALI" not "Name:" then "BENALI")
- Preserve paragraph structure with blank lines between sections
- Do NOT translate — return the original language
- Do NOT add commentary, explanations or metadata
- Return ONLY the extracted text`

/**
 * Convert a Blob/File to base64 string.
 */
async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

/**
 * Extract text from an image using Gemini Vision.
 * Returns the extracted text or throws if unavailable.
 */
export async function extractTextWithGemini(imageBlob, onProgress) {
  if (!API_KEY) throw new Error('GEMINI_KEY_MISSING')

  onProgress?.(10)

  const base64 = await blobToBase64(imageBlob)
  const mimeType = imageBlob.type || 'image/jpeg'

  onProgress?.(20)

  const res = await fetch(`${GEMINI_ENDPOINT}?key=${API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType, data: base64 } },
        { text: EXTRACT_PROMPT }
      ]}],
      generationConfig: {
        temperature: 0.1,    // low temp = more deterministic, less hallucination
        maxOutputTokens: 4096,
      }
    }),
    signal: AbortSignal.timeout(30000)
  })

  onProgress?.(80)

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const msg = err.error?.message || `HTTP ${res.status}`
    // Quota exceeded or server error → caller falls back to Tesseract
    if (res.status === 429 || res.status === 503 || res.status === 500) {
      throw new Error('GEMINI_UNAVAILABLE: ' + msg)
    }
    throw new Error('GEMINI_ERROR: ' + msg)
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

  if (!text) throw new Error('GEMINI_EMPTY_RESPONSE')

  onProgress?.(100)
  return text
}

export function isGeminiAvailable() {
  return !!API_KEY
}
