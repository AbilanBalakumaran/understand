const CHUNK_SIZE = 4800
const DELAY_MS   = 150
const WORKER_URL = import.meta.env.VITE_GEMINI_WORKER_URL || null

// ─── DeepL / Cloudflare AI via Worker ─────────────────────────────────────
// Tried BEFORE Google Translate for better quality on native PDF text.

async function workerTranslate(text, sourceLang, targetLang) {
  if (!WORKER_URL) throw new Error('NO_WORKER')
  const res = await fetch(WORKER_URL + '/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, sourceLang, targetLang }),
    signal: abortAfter(15000),
  })
  const data = await res.json()
  if (!res.ok || !data.text) throw new Error(data.error || 'Worker translate failed')
  return { translated: data.text, detectedLang: data.detectedLang || null, provider: data.provider }
}

// AbortSignal.timeout is available Chrome 103+, Firefox 100+, Safari 16+.
// For older browsers (some Android < 2022), fall back to a manual abort.
function abortAfter(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), ms)
  return ac.signal
}

// ─── Google Translate unofficial (no key required) ─────────────────────────
// Uses the same endpoint as many browser extensions. Reliable, supports all
// language pairs and scripts natively.

async function googleTranslate(text, sourceLang, targetLang) {
  const sl  = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0]
  const tl  = targetLang.split('-')[0]
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`

  const res = await fetch(url, { signal: abortAfter(12000) })
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`)

  const data = await res.json()

  // Response: [[["translated","original",...], ...], null, "detected_lang"]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Google: unexpected response format')
  }

  const translated = data[0]
    .filter(Array.isArray)
    .map(part => part[0] || '')
    .join('')

  if (!translated.trim()) throw new Error('Google: empty result')

  // data[2] is the detected source language code (e.g. "fr", "ar", "zh-CN")
  const detectedLang = typeof data[2] === 'string' ? data[2] : null

  return { translated, detectedLang }
}

// ─── MyMemory (Latin-script fallback) ─────────────────────────────────────

const LATIN_LANG_CODES = new Set([
  'af','sq','az','bs','ca','hr','cs','da','nl','en','et',
  'fi','fr','de','ht','hu','id','it','lv','lt','ms','no',
  'pl','pt','ro','sk','sl','so','es','sw','sv','tl','tr',
  'uz','vi','cy','yo','zu','pt-BR',
])

async function myMemoryTranslate(text, sourceLang, targetLang) {
  // MyMemory rejects 'auto' as source — use 'en' as neutral guess for unknown source.
  // This fallback is only reached when Google is down, so the detected language
  // is unavailable anyway; 'en' is the most common administrative document language.
  const src = (!sourceLang || sourceLang === 'auto') ? 'en' : sourceLang
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${src}|${targetLang}`
  const res = await fetch(url, { signal: abortAfter(10000) })
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`)
  const data = await res.json()
  if (data.quotaFinished === true) throw new Error('QUOTA_EXCEEDED')
  const translated = data.responseData?.translatedText ?? ''
  if (translated.includes('MYMEMORY WARNING') || translated.includes('YOU USED ALL AVAILABLE')) {
    throw new Error('QUOTA_EXCEEDED')
  }
  if (data.responseStatus !== 200) throw new Error(`MyMemory: ${data.responseDetails || data.responseStatus}`)
  if (!translated) throw new Error('MyMemory: empty result')
  return translated
}

// ─── Lingva instances (last resort) ───────────────────────────────────────

const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
  'https://lingva.thedaviddelta.com',
  'https://lingva.lunar.icu',
  'https://lingva.garudalinux.org',
]

async function lingvaTranslate(text, sourceLang, targetLang) {
  const src = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0]
  const tgt = targetLang.split('-')[0]
  const errors = []
  for (const instance of LINGVA_INSTANCES) {
    try {
      const url = `${instance}/api/v1/${src}/${tgt}/${encodeURIComponent(text)}`
      const res = await fetch(url, { signal: abortAfter(10000) })
      if (!res.ok) { errors.push(`${instance}: HTTP ${res.status}`); continue }
      const data = await res.json()
      if (data.translation) return data.translation
    } catch (e) {
      errors.push(`${instance}: ${e.message}`)
    }
  }
  throw new Error(`Toutes les instances Lingva sont indisponibles. (${errors.slice(0, 2).join(' / ')})`)
}

// ─── Chunk splitter ────────────────────────────────────────────────────────

function splitIntoChunks(text) {
  if (text.length <= CHUNK_SIZE) return [text]
  const chunks = []
  let start = 0
  while (start < text.length) {
    let end = start + CHUNK_SIZE
    if (end >= text.length) { chunks.push(text.slice(start)); break }
    const slice = text.slice(start, end)
    const lastSentence = Math.max(
      slice.lastIndexOf('. '), slice.lastIndexOf('.\n'),
      slice.lastIndexOf('! '), slice.lastIndexOf('? ')
    )
    const lastSpace = slice.lastIndexOf(' ')
    const breakAt = lastSentence > CHUNK_SIZE * 0.5 ? lastSentence + 1
      : lastSpace > 0 ? lastSpace : CHUNK_SIZE
    chunks.push(text.slice(start, start + breakAt).trim())
    start += breakAt
  }
  return chunks.filter(c => c.length > 0)
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

// ─── Per-chunk translation with cascade fallback ───────────────────────────
//
// Priority:
//   1. Worker (DeepL → Cloudflare AI) — best quality for supported languages
//   2. Google Translate unofficial    — reliable, all scripts
//   3. MyMemory                       — Latin only
//   4. Lingva                         — last resort

async function translateChunk(chunk, sourceLang, targetLang) {
  const tgtBase = targetLang.split('-')[0]
  const isNonLatinTarget = !LATIN_LANG_CODES.has(tgtBase)

  // 1. Worker: DeepL or Cloudflare AI (best quality)
  try {
    const { translated, detectedLang } = await workerTranslate(chunk, sourceLang, targetLang)
    if (translated?.trim()) {
      if (detectedLang && detectedLang.split('-')[0] === tgtBase) return { text: chunk, detectedLang }
      return { text: translated, detectedLang }
    }
  } catch (_) {}

  // 2. Google Translate (all scripts, no key)
  try {
    const { translated, detectedLang } = await googleTranslate(chunk, sourceLang, targetLang)

    // If Google detected the same language as the target, the document is
    // already in the right language — return as-is (not an error).
    if (detectedLang && detectedLang.split('-')[0] === tgtBase) {
      return { text: chunk, detectedLang }
    }

    if (chunk.length > 20 && translated.trim() === chunk.trim()) {
      // Unexpected identity (different lang codes but same output) — still return
      // the text rather than crashing. The caller will decide what to show.
      return { text: chunk, detectedLang }
    }
    return { text: translated, detectedLang }
  } catch (_) {}

  // 3. MyMemory (Latin targets only)
  if (!isNonLatinTarget) {
    try {
      const result = await myMemoryTranslate(chunk, sourceLang, targetLang)
      if (chunk.length > 20 && result.trim() === chunk.trim()) {
        throw new Error('Identity translation')
      }
      return { text: result, detectedLang: null }
    } catch (mmErr) {
      if (mmErr.message !== 'QUOTA_EXCEEDED' && mmErr.message !== 'Identity translation') {
        console.warn('[translate] MyMemory failed:', mmErr.message)
      }
    }
  }

  // 4. Last resort: Lingva
  const result = await lingvaTranslate(chunk, sourceLang, targetLang)
  return { text: result, detectedLang: null }
}

// ─── Post-translation cleaning ─────────────────────────────────────────────

function cleanTranslatedText(text) {
  return text
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')   // control chars
    // Strip only invisible formatting characters that serve no display purpose.
    // U+200C (ZWNJ) and U+200D (ZWJ) are intentionally preserved:
    //   ZWNJ is required for correct Farsi/Urdu word breaks.
    //   ZWJ is required for multi-part emoji sequences (👨‍👩‍👧).
    .replace(/[​‎‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Public API ────────────────────────────────────────────────────────────

// Returns { text, detectedLang } where detectedLang is the ISO code Google
// identified for the source (e.g. "fr", "ar") — null if unavailable.
export async function translateText(text, sourceLang, targetLang, onProgress) {
  if (!text?.trim()) return { text: '', detectedLang: null }

  const srcBase = sourceLang.split('-')[0].toLowerCase()
  const tgtBase = targetLang.split('-')[0].toLowerCase()
  if (srcBase !== 'auto' && srcBase === tgtBase) return { text, detectedLang: srcBase }

  const chunks     = splitIntoChunks(text)
  const parts      = []
  let   detectedLang = null

  for (let i = 0; i < chunks.length; i++) {
    const { text: translated, detectedLang: dl } = await translateChunk(chunks[i], sourceLang, targetLang)
    parts.push(translated)
    if (!detectedLang && dl) detectedLang = dl
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100))
    if (i < chunks.length - 1) await sleep(DELAY_MS)
  }

  return { text: cleanTranslatedText(parts.join('\n\n')), detectedLang }
}
