/**
 * Cloudflare Worker — multi-AI proxy
 *
 * Secrets (set in Worker Settings → Variables & Secrets):
 *   GEMINI_API_KEY    — Google AI Studio (required)
 *   DEEPL_API_KEY     — DeepL free API   (optional, improves translation)
 *   GOOGLE_TTS_KEY    — Google Cloud TTS (optional, improves audio)
 *
 * Bindings (wrangler.toml):
 *   AI                — Cloudflare Workers AI (free fallback for translate/summarize)
 *
 * Endpoints:
 *   POST /process     { image, mimeType, targetLangName }
 *   POST /check       { image, mimeType }
 *   POST /translate   { text, sourceLang, targetLang, targetLangName }
 *   POST /summarize   { text, targetLangName }
 *   POST /tts         { text, lang, langName }
 */

// ─── Models ───────────────────────────────────────────────────────────────

const GEMINI_BASE     = 'https://generativelanguage.googleapis.com/v1beta/models'
const GEMINI_MODEL    = 'gemini-2.5-flash'
const GEMINI_TTS      = 'gemini-2.5-flash-preview-tts'
const DEEPL_URL       = 'https://api-free.deepl.com/v2/translate'
const GOOGLE_TTS_URL  = 'https://texttospeech.googleapis.com/v1/text:synthesize'

// ─── Language code mappings ────────────────────────────────────────────────

// DeepL uses uppercase ISO codes + some special cases
const TO_DEEPL = {
  fr:'FR',en:'EN-US',es:'ES',de:'DE',it:'IT',pt:'PT-PT',nl:'NL',
  pl:'PL',ru:'RU',ja:'JA',zh:'ZH',ko:'KO',tr:'TR',uk:'UK',
  cs:'CS',sv:'SV',da:'DA',fi:'FI',nb:'NB',ro:'RO',hu:'HU',
  hr:'HR',sk:'SK',sl:'SL',et:'ET',lv:'LV',lt:'LT',bg:'BG',el:'EL',
  id:'ID',vi:'VI',ar:null,hi:null,ta:null,th:null,he:null, // not supported by DeepL
}

// Cloudflare m2m100 uses full lowercase language names
const TO_CF_AI = {
  fr:'french',en:'english',es:'spanish',de:'german',it:'italian',
  pt:'portuguese',nl:'dutch',pl:'polish',ru:'russian',ja:'japanese',
  zh:'chinese',ko:'korean',ar:'arabic',tr:'turkish',uk:'ukrainian',
  cs:'czech',sv:'swedish',da:'danish',fi:'finnish',ro:'romanian',
  hu:'hungarian',bg:'bulgarian',el:'greek',he:'hebrew',hi:'hindi',
  bn:'bengali',ta:'tamil',te:'telugu',th:'thai',id:'indonesian',
  ms:'malay',vi:'vietnamese',ka:'georgian',hy:'armenian',
}

// ─── CORS ─────────────────────────────────────────────────────────────────

const ALLOWED_ORIGINS = [
  'https://abilanbalakumaran.github.io',
  'https://sweet-credit-4b8a.mangateamz2.workers.dev',
  'http://localhost:5173',
  'http://localhost:4173',
]

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]
  return {
    'Access-Control-Allow-Origin':  allowed,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  }
}

function jsonRes(body, status, cors) {
  return new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json', ...cors }
  })
}

// ─── Gemini helpers ────────────────────────────────────────────────────────

async function geminiGenerate(apiKey, model, parts, config = {}) {
  const r = await fetch(`${GEMINI_BASE}/${model}:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: { temperature: 0.1, maxOutputTokens: 8192, ...config },
    }),
  })
  if (!r.ok) {
    const e = await r.json().catch(() => ({}))
    throw Object.assign(new Error(e.error?.message || `Gemini ${r.status}`),
      { status: r.status >= 500 || r.status === 429 ? r.status : 502 })
  }
  const d = await r.json()
  return d.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
}

// ─── PCM → WAV ────────────────────────────────────────────────────────────

function pcmToWav(pcmBase64) {
  const pcm = Uint8Array.from(atob(pcmBase64), c => c.charCodeAt(0))
  const sr = 24000, ch = 1, bps = 16
  const buf = new ArrayBuffer(44 + pcm.length)
  const v   = new DataView(buf)
  const s   = (o, str) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  s(0,'RIFF'); v.setUint32(4, 36+pcm.length, true)
  s(8,'WAVE'); s(12,'fmt '); v.setUint32(16,16,true); v.setUint16(20,1,true)
  v.setUint16(22,ch,true); v.setUint32(24,sr,true); v.setUint32(28,sr*ch*bps/8,true)
  v.setUint16(32,ch*bps/8,true); v.setUint16(34,bps,true)
  s(36,'data'); v.setUint32(40,pcm.length,true)
  new Uint8Array(buf,44).set(pcm)
  return new Uint8Array(buf)
}

// ─── Prompts ──────────────────────────────────────────────────────────────

function processPrompt(langName) {
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

const CHECK_PROMPT = `Assess this image for document OCR. Reply ONLY valid JSON:
{"ok":true} if clear readable text is visible.
{"ok":false,"issue":"brief reason"} if too blurry, dark, or no text.`

function summaryPrompt(langName) {
  return `Summarize this document in 2-3 short sentences in ${langName}. Include: document type, key names, dates, reference numbers. No preamble, go straight to facts.`
}

// ─── Main handler ──────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || ''
    const cors   = corsHeaders(origin)
    const path   = new URL(request.url).pathname

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors })
    if (request.method !== 'POST')    return jsonRes({ error: 'Method not allowed' }, 405, cors)

    const key = env.GEMINI_API_KEY
    if (!key) return jsonRes({ error: 'Gemini key not configured' }, 500, cors)

    let body
    try { body = await request.json() } catch { return jsonRes({ error: 'Invalid JSON' }, 400, cors) }

    // ══ /process — OCR + translate (Gemini) ═══════════════════════════════
    if (path === '/process') {
      const { image, mimeType = 'image/jpeg', targetLangName } = body
      if (!image || !targetLangName) return jsonRes({ error: 'Missing fields' }, 400, cors)
      try {
        const text = await geminiGenerate(key, GEMINI_MODEL, [
          { inlineData: { mimeType, data: image } },
          { text: processPrompt(targetLangName) },
        ])
        if (!text) return jsonRes({ error: 'No text extracted' }, 502, cors)
        return jsonRes({ text }, 200, cors)
      } catch (e) { return jsonRes({ error: e.message }, e.status || 502, cors) }
    }

    // ══ /check — image quality ════════════════════════════════════════════
    if (path === '/check') {
      const { image, mimeType = 'image/jpeg' } = body
      if (!image) return jsonRes({ error: 'Missing image' }, 400, cors)
      try {
        const raw  = await geminiGenerate(key, GEMINI_MODEL, [
          { inlineData: { mimeType, data: image } }, { text: CHECK_PROMPT }
        ], { temperature: 0, maxOutputTokens: 64 })
        const clean = raw.replace(/^```[a-z]*\n?/i,'').replace(/\n?```$/,'').trim()
        return jsonRes(JSON.parse(clean), 200, cors)
      } catch { return jsonRes({ ok: true }, 200, cors) }
    }

    // ══ /translate — DeepL → CF Workers AI → error ════════════════════════
    if (path === '/translate') {
      const { text, sourceLang = 'auto', targetLang, targetLangName } = body
      if (!text || !targetLang) return jsonRes({ error: 'Missing fields' }, 400, cors)

      const tgtBase = targetLang.split('-')[0].toLowerCase()

      // 1. DeepL (best quality for supported languages)
      if (env.DEEPL_API_KEY) {
        const deeplTgt = TO_DEEPL[tgtBase]
        if (deeplTgt) {
          try {
            const payload = { text: [text], target_lang: deeplTgt }
            if (sourceLang !== 'auto') {
              const srcBase = sourceLang.split('-')[0].toLowerCase()
              const deeplSrc = TO_DEEPL[srcBase]
              if (deeplSrc) payload.source_lang = deeplSrc.split('-')[0]
            }
            const r = await fetch(DEEPL_URL, {
              method: 'POST',
              headers: { 'Content-Type':'application/json', 'Authorization': `DeepL-Auth-Key ${env.DEEPL_API_KEY}` },
              body: JSON.stringify(payload),
            })
            if (r.ok) {
              const d = await r.json()
              const translated = d.translations?.[0]?.text
              if (translated) {
                return jsonRes({ text: translated, provider: 'deepl', detectedLang: d.translations?.[0]?.detected_source_language?.toLowerCase() }, 200, cors)
              }
            }
          } catch (_) {}
        }
      }

      // 2. Cloudflare Workers AI (m2m100 — 200 languages, free)
      if (env.AI) {
        const cfTgt = TO_CF_AI[tgtBase]
        const cfSrc = sourceLang !== 'auto' ? TO_CF_AI[sourceLang.split('-')[0].toLowerCase()] : 'auto'
        if (cfTgt) {
          try {
            const result = await env.AI.run('@cf/meta/m2m100-1.2b', {
              text,
              source_lang: cfSrc || 'auto',
              target_lang: cfTgt,
            })
            if (result?.translated_text) {
              return jsonRes({ text: result.translated_text, provider: 'cf-ai' }, 200, cors)
            }
          } catch (_) {}
        }
      }

      return jsonRes({ error: 'All translation services unavailable' }, 502, cors)
    }

    // ══ /summarize — Gemini → CF Workers AI ═══════════════════════════════
    if (path === '/summarize') {
      const { text, targetLangName } = body
      if (!text || !targetLangName) return jsonRes({ error: 'Missing fields' }, 400, cors)

      // 1. Gemini (best quality)
      try {
        const summary = await geminiGenerate(key, GEMINI_MODEL, [
          { text: summaryPrompt(targetLangName) + '\n\n---\n\n' + text }
        ], { temperature: 0.2, maxOutputTokens: 256 })
        if (summary) return jsonRes({ summary, provider: 'gemini' }, 200, cors)
      } catch (_) {}

      // 2. Cloudflare Workers AI (free fallback)
      if (env.AI) {
        try {
          const r = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
            messages: [
              { role: 'system', content: `Summarize the following document in 2-3 sentences in ${targetLangName}. Be concise and factual.` },
              { role: 'user',   content: text.slice(0, 3000) },
            ],
            max_tokens: 200,
          })
          const summary = r?.response?.trim()
          if (summary) return jsonRes({ summary, provider: 'cf-ai' }, 200, cors)
        } catch (_) {}
      }

      return jsonRes({ error: 'Summary unavailable' }, 502, cors)
    }

    // ══ /tts — Gemini TTS → Google Cloud TTS → error ═════════════════════
    if (path === '/tts') {
      const { text, lang = 'fr', langName } = body
      if (!text) return jsonRes({ error: 'Missing text' }, 400, cors)

      // 1. ElevenLabs (best voice quality, multilingual)
      if (env.ELEVENLABS_API_KEY) {
        try {
          const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM', {
            method: 'POST',
            headers: {
              'xi-api-key': env.ELEVENLABS_API_KEY,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              text,
              model_id: 'eleven_multilingual_v2',
              voice_settings: { stability: 0.5, similarity_boost: 0.75 },
            }),
          })
          if (r.ok) {
            const mp3 = await r.arrayBuffer()
            if (mp3.byteLength > 100) {
              return new Response(mp3, { status: 200, headers: { 'Content-Type': 'audio/mpeg', ...cors } })
            }
          }
        } catch (_) {}
      }

      // 2. Gemini TTS
      try {
        const r = await fetch(`${GEMINI_BASE}/${GEMINI_TTS}:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text }] }],
            generationConfig: {
              response_modalities: ['AUDIO'],
              speech_config: { voice_config: { prebuilt_voice_config: { voice_name: 'Kore' } } },
            },
          }),
        })
        if (r.ok) {
          const d = await r.json()
          const part = d.candidates?.[0]?.content?.parts?.[0]?.inlineData
          if (part?.data) {
            const wav = pcmToWav(part.data)
            return new Response(wav, { status: 200, headers: { 'Content-Type': 'audio/wav', ...cors } })
          }
        }
      } catch (_) {}

      // 2. Google Cloud TTS (official, better voices, SSML support)
      if (env.GOOGLE_TTS_KEY) {
        try {
          // Build BCP-47 voice code — use neutral gender for widest language support
          const langCode = lang.includes('-') ? lang : `${lang}-${lang.toUpperCase()}`
          const r = await fetch(`${GOOGLE_TTS_URL}?key=${env.GOOGLE_TTS_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input: { text },
              voice: { languageCode: langCode, ssmlGender: 'NEUTRAL' },
              audioConfig: { audioEncoding: 'MP3', speakingRate: 0.95 },
            }),
          })
          if (r.ok) {
            const d = await r.json()
            if (d.audioContent) {
              const mp3 = Uint8Array.from(atob(d.audioContent), c => c.charCodeAt(0))
              return new Response(mp3, { status: 200, headers: { 'Content-Type': 'audio/mpeg', ...cors } })
            }
          }
        } catch (_) {}
      }

      return jsonRes({ error: 'TTS unavailable' }, 502, cors)
    }

    return jsonRes({ error: 'Not found' }, 404, cors)
  },
}
