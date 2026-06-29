/**
 * Cloudflare Worker — Gemini Vision proxy
 *
 * POST /ocr            { image, mimeType }
 *   → Extract text only (fallback path)
 *
 * POST /process        { image, mimeType, targetLang, targetLangName }
 *   → OCR + translate in one Gemini call (primary path, best quality)
 *
 * All Gemini calls are server-side; the API key never reaches the browser.
 */

const GEMINI_MODEL   = 'gemini-2.5-flash'
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`

const ALLOWED_ORIGINS = [
  'https://abilanbalakumaran.github.io',
  'https://sweet-credit-4b8a.mangateamz2.workers.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

// ─── Prompts ──────────────────────────────────────────────────────────────

const OCR_ONLY_PROMPT = `Extract ALL text from this document image.

Rules:
- Preserve the exact content (names, dates, numbers, reference codes)
- Reconstruct fragmented lines: join split titles and field values
- Keep field labels with their values on the same line
- Preserve paragraph structure with blank lines between sections
- Do NOT translate — return the original language
- Do NOT add commentary or metadata
- Return ONLY the extracted text`

function buildProcessPrompt(targetLangName) {
  return `You are processing a document image. Perform two steps in sequence:

STEP 1 — Extract ALL text from the document image exactly as written.

STEP 2 — Translate the extracted text into ${targetLangName}.

Translation rules:
- Preserve ALL data: names, dates, numbers, reference codes, addresses, amounts
- Keep the document structure (field label + value on the same line)
- Produce natural, fluent ${targetLangName} — not a word-for-word literal translation
- Numbers, dates, proper nouns and codes stay as-is (do not translate "DUPONT", "FR76…", "2024-001")
- Blank lines between sections should be preserved

Return ONLY the translated text. No commentary, no "Step 1:", no explanations.`
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  }
}

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  })
}

async function callGemini(apiKey, imageData, mimeType, prompt) {
  const res = await fetch(`${GEMINI_API_URL}?key=${apiKey}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [
        { inlineData: { mimeType, data: imageData } },
        { text: prompt },
      ]}],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const status = res.status === 429 || res.status >= 500 ? res.status : 502
    throw Object.assign(new Error(err.error?.message || `Gemini HTTP ${res.status}`), { status })
  }

  const data = await res.json()
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()
  if (!text) throw Object.assign(new Error('Gemini returned no text'), { status: 502 })
  return text
}

// ─── Main handler ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin  = request.headers.get('Origin') || ''
    const cors    = corsHeaders(origin)
    const url     = new URL(request.url)

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors)
    }

    const apiKey = env.GEMINI_API_KEY
    if (!apiKey) return json({ error: 'API key not configured' }, 500, cors)

    let body
    try { body = await request.json() }
    catch { return json({ error: 'Invalid JSON' }, 400, cors) }

    const { image, mimeType = 'image/jpeg', targetLang, targetLangName } = body
    if (!image) return json({ error: 'Missing image' }, 400, cors)

    // ── Route: /process — OCR + translate in one call (best quality) ────────
    if (url.pathname === '/process') {
      if (!targetLangName) return json({ error: 'Missing targetLangName' }, 400, cors)
      try {
        const text = await callGemini(apiKey, image, mimeType, buildProcessPrompt(targetLangName))
        return json({ text }, 200, cors)
      } catch (err) {
        return json({ error: err.message }, err.status || 502, cors)
      }
    }

    // ── Route: /ocr — extract text only (Tesseract fallback path) ───────────
    try {
      const text = await callGemini(apiKey, image, mimeType, OCR_ONLY_PROMPT)
      return json({ text }, 200, cors)
    } catch (err) {
      return json({ error: err.message }, err.status || 502, cors)
    }
  },
}
