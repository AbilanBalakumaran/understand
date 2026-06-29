/**
 * Cloudflare Worker — Gemini Vision OCR proxy
 *
 * Accepts POST /ocr with { image: base64, mimeType: string }
 * Calls Gemini on the server side (key never exposed to the browser).
 * Returns { text: string } or { error: string }.
 */

const GEMINI_MODEL = 'gemini-2.5-flash'
const ALLOWED_ORIGINS = [
  'https://abilanbalakumaran.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
]

const EXTRACT_PROMPT = `Extract ALL text from this document image.

Rules:
- Preserve the exact content (names, dates, numbers, reference codes)
- Reconstruct fragmented lines: if a title or field value is split across multiple lines, join them
- Keep field labels with their values on the same line (e.g. "Name: BENALI" not "Name:" then "BENALI")
- Preserve paragraph structure with blank lines between sections
- Do NOT translate — return the original language
- Do NOT add commentary, explanations or metadata
- Return ONLY the extracted text`

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const headers = corsHeaders(origin)

    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers })
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405, headers: { ...headers, 'Content-Type': 'application/json' }
      })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
      })
    }

    const { image, mimeType = 'image/jpeg' } = body
    if (!image) {
      return new Response(JSON.stringify({ error: 'Missing image field' }), {
        status: 400, headers: { ...headers, 'Content-Type': 'application/json' }
      })
    }

    const apiKey = env.GEMINI_API_KEY
    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'API key not configured' }), {
        status: 500, headers: { ...headers, 'Content-Type': 'application/json' }
      })
    }

    // Call Gemini
    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType, data: image } },
            { text: EXTRACT_PROMPT }
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 4096 }
        })
      }
    )

    if (!geminiRes.ok) {
      const err = await geminiRes.json().catch(() => ({}))
      return new Response(JSON.stringify({ error: err.error?.message || `Gemini HTTP ${geminiRes.status}` }), {
        status: geminiRes.status === 429 ? 429 : 502,
        headers: { ...headers, 'Content-Type': 'application/json' }
      })
    }

    const data = await geminiRes.json()
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim()

    if (!text) {
      return new Response(JSON.stringify({ error: 'Gemini returned no text' }), {
        status: 502, headers: { ...headers, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { ...headers, 'Content-Type': 'application/json' }
    })
  }
}
