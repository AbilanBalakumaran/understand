/**
 * Gemini services — two modes:
 *
 * 1. Via Cloudflare Worker (preferred — API key server-side, secure)
 *    Used when VITE_GEMINI_WORKER_URL is set and reachable.
 *
 * 2. Direct Gemini API (fallback — key in bundle, acceptable for free tier)
 *    Used when Worker is unreachable (SSL issue, quota, not yet deployed).
 *    Activated by VITE_GEMINI_API_KEY.
 */

const WORKER_URL  = import.meta.env.VITE_GEMINI_WORKER_URL || null
const DIRECT_KEY  = import.meta.env.VITE_GEMINI_API_KEY    || null
const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
const MODEL       = 'gemini-2.5-flash'

export function isGeminiAvailable() {
  return !!(WORKER_URL || DIRECT_KEY)
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

function buildProcessPrompt(langName) {
  return `You are an expert document reader. Process this document image/PDF:

STEP 1 — Identify the document type:
  • Identity (passport, ID card, residence permit, visa)
  • Administrative (contract, letter, official notice)
  • Financial (invoice, receipt, bank statement, payslip)
  • Medical (prescription, report, certificate)

STEP 2 — Extract ALL text based on the document type:
  • Identity: full name, nationality, date of birth, document number, issue/expiry dates, issuing authority, MRZ lines
  • Administrative: all parties, dates, reference numbers, full body text
  • Financial: vendor, all line items with prices, totals, VAT, dates, account numbers
  • Medical: patient, doctor, dates, diagnosis, prescriptions, dosages
  • Any type: NEVER skip a field — extract everything visible

STEP 3 — Translate extracted text into ${langName}.
  • Natural fluent ${langName} — not literal word-for-word
  • Names, codes, IBANs, SIRETs, reference numbers stay exactly as written
  • Keep field label + value on the same line
  • Preserve blank lines between sections

Return ONLY the final translated text. No step labels or document type header.`
}

// ─── Direct Gemini API call (fallback when Worker is unavailable) ──────────

async function callGeminiDirect(parts, config = {}) {
  if (!DIRECT_KEY) throw new Error('GEMINI_KEY_MISSING')
  const res = await fetch(`${GEMINI_BASE}/${MODEL}:generateContent?key=${DIRECT_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, ...config },
    }),
    signal: AbortSignal.timeout(45000),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    const msg = e.error?.message || `Gemini HTTP ${res.status}`
    if (res.status === 429 || res.status >= 500) throw new Error('GEMINI_UNAVAILABLE: ' + msg)
    throw new Error('GEMINI_ERROR: ' + msg)
  }
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
}

// ─── Worker call (preferred path) ─────────────────────────────────────────

async function postWorker(path, body, timeout = 45000) {
  if (!WORKER_URL) throw new Error('NO_WORKER')
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
    return res.blob()
  }
  const data = await res.json()
  if (!res.ok) {
    const msg = data.error || `HTTP ${res.status}`
    if (res.status === 429 || res.status >= 500) throw new Error('GEMINI_UNAVAILABLE: ' + msg)
    throw new Error('GEMINI_ERROR: ' + msg)
  }
  return data
}

// ─── 1. OCR + Translation (primary path) ──────────────────────────────────

export async function processWithGemini(imageBlob, targetLang, onProgress) {
  onProgress?.(10)
  const base64   = await blobToBase64(imageBlob)
  const mimeType = imageBlob.type || 'image/jpeg'
  const langName = targetLang.nameFr || targetLang.name
  onProgress?.(25)

  // Try Worker first (keeps key server-side)
  if (WORKER_URL) {
    try {
      const data = await postWorker('/process', { image: base64, mimeType, targetLangName: langName })
      if (data.text?.trim()) { onProgress?.(100); return data.text }
    } catch (e) {
      if (!e.message?.startsWith('GEMINI_UNAVAILABLE') && !e.message?.startsWith('NO_WORKER')) throw e
      // Worker unavailable → fall through to direct API
    }
  }

  // Direct Gemini API (fallback — key in bundle)
  const text = await callGeminiDirect([
    { inlineData: { mimeType, data: base64 } },
    { text: buildProcessPrompt(langName) },
  ])
  if (!text) throw new Error('GEMINI_EMPTY_RESPONSE')
  onProgress?.(100)
  return text
}

// ─── 2. Image quality check ────────────────────────────────────────────────

export async function checkImageQuality(imageBlob) {
  try {
    const base64   = await blobToBase64(imageBlob)
    const mimeType = imageBlob.type || 'image/jpeg'
    const prompt   = `Assess this image for document OCR. Reply ONLY valid JSON:
{"ok":true} if clear readable text is visible.
{"ok":false,"issue":"brief reason"} if too blurry, dark, or no text.`

    let raw = ''
    if (WORKER_URL) {
      try {
        const data = await postWorker('/check', { image: base64, mimeType }, 15000)
        return { ok: data.ok !== false, issue: data.issue || null }
      } catch (_) {}
    }
    raw = await callGeminiDirect([
      { inlineData: { mimeType, data: base64 } },
      { text: prompt },
    ], { temperature: 0, maxOutputTokens: 64 })
    const clean = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
    const result = JSON.parse(clean)
    return { ok: result.ok !== false, issue: result.issue || null }
  } catch {
    return { ok: true }  // never block on check failure
  }
}

// ─── 3. Document summary ───────────────────────────────────────────────────

export async function summarizeDocument(translatedText, targetLang) {
  if (!isGeminiAvailable() || !translatedText) return null
  const langName = targetLang.nameFr || targetLang.name
  const prompt   = `Summarize this document in 2-3 short sentences in ${langName}. Include: document type, key names, important dates, reference numbers. No preamble.`
  try {
    if (WORKER_URL) {
      try {
        const data = await postWorker('/summarize', { text: translatedText, targetLangName: langName }, 20000)
        return data.summary || null
      } catch (_) {}
    }
    const summary = await callGeminiDirect([
      { text: prompt + '\n\n---\n\n' + translatedText }
    ], { temperature: 0.2, maxOutputTokens: 256 })
    return summary || null
  } catch {
    return null
  }
}

// ─── 4. Gemini TTS ────────────────────────────────────────────────────────

export async function generateAudioWithGemini(text, lang) {
  if (!WORKER_URL) throw new Error('GEMINI_KEY_MISSING')
  const blob = await postWorker('/tts', { text, lang }, 30000)
  if (!blob || blob.size < 100) throw new Error('GEMINI_UNAVAILABLE: empty audio')
  return blob
}

// ─── OCR-only (Tesseract fallback path) ───────────────────────────────────

export async function extractTextWithGemini(imageBlob, onProgress) {
  onProgress?.(10)
  const base64   = await blobToBase64(imageBlob)
  const mimeType = imageBlob.type || 'image/jpeg'
  onProgress?.(25)

  const prompt = `Extract ALL text from this document image. Preserve structure and field values. Return ONLY the text.`

  if (WORKER_URL) {
    try {
      const data = await postWorker('/ocr', { image: base64, mimeType })
      if (data.text?.trim()) { onProgress?.(100); return data.text }
    } catch (_) {}
  }

  const text = await callGeminiDirect([
    { inlineData: { mimeType, data: base64 } },
    { text: prompt },
  ])
  if (!text) throw new Error('GEMINI_EMPTY_RESPONSE')
  onProgress?.(100)
  return text
}
