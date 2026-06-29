/**
 * Cloudflare Worker — Gemini proxy
 *
 * POST /process    { image, mimeType, targetLangName }
 *   OCR + translate in one call (images AND native PDFs)
 *
 * POST /check      { image, mimeType }
 *   Quick image quality assessment before full processing
 *
 * POST /summarize  { text, targetLangName }
 *   Generate a 2-3 sentence summary of the translated document
 *
 * POST /tts        { text, lang }
 *   Convert text to speech using Gemini TTS (returns audio/wav blob)
 */

const GEMINI_BASE    = 'https://generativelanguage.googleapis.com/v1beta/models'
const PROCESS_MODEL  = 'gemini-2.5-flash'
const TTS_MODEL      = 'gemini-2.5-flash-preview-tts'

const ALLOWED_ORIGINS = [
  'https://abilanbalakumaran.github.io',
  'https://sweet-credit-4b8a.mangateamz2.workers.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

// ─── Prompts ──────────────────────────────────────────────────────────────

function buildProcessPrompt(targetLangName) {
  return `You are processing a document image or PDF. Perform two steps:

STEP 1 — Extract ALL text from the document exactly as written.
STEP 2 — Translate the extracted text into ${targetLangName}.

Rules:
- Preserve ALL data: names, dates, numbers, codes, addresses, amounts
- Keep document structure (field label + value on the same line)
- Produce natural, fluent ${targetLangName}
- Proper nouns, codes, reference numbers stay as-is
- Blank lines between sections should be preserved

Return ONLY the translated text. No step labels, no commentary.`
}

const CHECK_PROMPT = `Look at this image and answer ONLY with valid JSON, nothing else.
Assess whether it contains readable document text.

{"ok": true} if the image has clear, readable text.
{"ok": false, "issue": "brief reason"} if:
- The image is too blurry or out of focus
- The image is too dark or overexposed
- No text is visible
- The document is cut off or severely cropped

Reply with JSON only, no markdown.`

function buildSummaryPrompt(targetLangName) {
  return `Summarize the key information from this document in 2-3 short sentences in ${targetLangName}.

Include: document type, key names, important dates, reference numbers, validity.
Be concise and direct. No preamble like "This document..." — go straight to the facts.`
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  }
}

function jsonResponse(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  })
}

async function geminiText(apiKey, model, parts, config = {}) {
  const res = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, ...config },
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const status = res.status === 429 || res.status >= 500 ? res.status : 502
    throw Object.assign(new Error(err.error?.message || `Gemini HTTP ${res.status}`), { status })
  }
  const data = await res.json()
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
}

// PCM (16-bit, 24 kHz, mono) → WAV bytes
function pcmToWav(pcmBase64) {
  const pcm        = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0))
  const sampleRate = 24000
  const numCh      = 1
  const bps        = 16
  const byteRate   = sampleRate * numCh * (bps / 8)
  const blockAlign = numCh * (bps / 8)
  const buf        = new ArrayBuffer(44 + pcm.length)
  const v          = new DataView(buf)
  const s          = (off, str) => [...str].forEach((c, i) => v.setUint8(off + i, c.charCodeAt(0)))
  s(0, 'RIFF');  v.setUint32(4,  36 + pcm.length, true)
  s(8, 'WAVE');  s(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true);     v.setUint16(22, numCh, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, byteRate, true)
  v.setUint16(32, blockAlign, true); v.setUint16(34, bps, true)
  s(36, 'data'); v.setUint32(40, pcm.length, true)
  new Uint8Array(buf, 44).set(pcm)
  return new Uint8Array(buf)
}

// ─── Main handler ─────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const cors   = corsHeaders(origin)
    const path   = new URL(request.url).pathname

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST')    return jsonResponse({ error: 'Method not allowed' }, 405, cors)

    const apiKey = env.GEMINI_API_KEY
    if (!apiKey) return jsonResponse({ error: 'API key not configured' }, 500, cors)

    let body
    try { body = await request.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400, cors) }

    // ── /process — OCR + translate (image or PDF) ──────────────────────────
    if (path === '/process') {
      const { image, mimeType = 'image/jpeg', targetLangName } = body
      if (!image || !targetLangName) return jsonResponse({ error: 'Missing fields' }, 400, cors)
      try {
        const text = await geminiText(apiKey, PROCESS_MODEL, [
          { inlineData: { mimeType, data: image } },
          { text: buildProcessPrompt(targetLangName) },
        ])
        if (!text) return jsonResponse({ error: 'No text extracted' }, 502, cors)
        return jsonResponse({ text }, 200, cors)
      } catch (e) { return jsonResponse({ error: e.message }, e.status || 502, cors) }
    }

    // ── /check — image quality assessment ─────────────────────────────────
    if (path === '/check') {
      const { image, mimeType = 'image/jpeg' } = body
      if (!image) return jsonResponse({ error: 'Missing image' }, 400, cors)
      try {
        const raw = await geminiText(apiKey, PROCESS_MODEL, [
          { inlineData: { mimeType, data: image } },
          { text: CHECK_PROMPT },
        ], { temperature: 0, maxOutputTokens: 64 })
        // Strip markdown code fences if Gemini wraps JSON
        const clean = raw.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '').trim()
        const result = JSON.parse(clean)
        return jsonResponse(result, 200, cors)
      } catch (e) {
        // If check fails, let processing continue — don't block the user
        return jsonResponse({ ok: true }, 200, cors)
      }
    }

    // ── /summarize — 2-3 sentence summary of translated text ──────────────
    if (path === '/summarize') {
      const { text, targetLangName } = body
      if (!text || !targetLangName) return jsonResponse({ error: 'Missing fields' }, 400, cors)
      try {
        const summary = await geminiText(apiKey, PROCESS_MODEL, [
          { text: buildSummaryPrompt(targetLangName) + '\n\n---\n\n' + text },
        ], { temperature: 0.2, maxOutputTokens: 256 })
        return jsonResponse({ summary }, 200, cors)
      } catch (e) { return jsonResponse({ error: e.message }, e.status || 502, cors) }
    }

    // ── /tts — text to speech via Gemini TTS ──────────────────────────────
    if (path === '/tts') {
      const { text, lang = 'fr' } = body
      if (!text) return jsonResponse({ error: 'Missing text' }, 400, cors)

      try {
        const res = await fetch(`${GEMINI_BASE}/${TTS_MODEL}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              response_modalities: ['AUDIO'],
              speech_config: {
                voice_config: { prebuilt_voice_config: { voice_name: 'Kore' } },
              },
            },
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          return jsonResponse({ error: err.error?.message || `TTS HTTP ${res.status}` }, res.status >= 500 ? 502 : res.status, cors)
        }

        const data = await res.json()
        const part = data.candidates?.[0]?.content?.parts?.[0]?.inlineData
        if (!part?.data) return jsonResponse({ error: 'No audio returned' }, 502, cors)

        // Convert PCM → WAV for universal browser playback
        const wav = pcmToWav(part.data)
        return new Response(wav, {
          status: 200,
          headers: { 'Content-Type': 'audio/wav', ...cors },
        })
      } catch (e) { return jsonResponse({ error: e.message }, 502, cors) }
    }

    return jsonResponse({ error: 'Not found' }, 404, cors)
  },
}
