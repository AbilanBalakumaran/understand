const CHUNK_SIZE = 4800  // Google unofficial API supports up to ~5000 chars
const DELAY_MS   = 150

// ─── Google Translate unofficial (no key required) ─────────────────────────
// Uses the same endpoint as many browser extensions. Reliable, supports all
// language pairs and scripts natively.

async function googleTranslate(text, sourceLang, targetLang) {
  const sl  = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0]
  const tl  = targetLang.split('-')[0]
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sl}&tl=${tl}&dt=t&q=${encodeURIComponent(text)}`

  const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`)

  const data = await res.json()

  // Response is [[["translated","original",...], ...], ...]
  if (!Array.isArray(data) || !Array.isArray(data[0])) {
    throw new Error('Google: unexpected response format')
  }

  const translated = data[0]
    .filter(Array.isArray)
    .map(part => part[0] || '')
    .join('')

  if (!translated.trim()) throw new Error('Google: empty result')
  return translated
}

// ─── MyMemory (Latin-script fallback) ─────────────────────────────────────

const LATIN_LANG_CODES = new Set([
  'af','sq','az','bs','ca','hr','cs','da','nl','en','et',
  'fi','fr','de','ht','hu','id','it','lv','lt','ms','no',
  'pl','pt','ro','sk','sl','so','es','sw','sv','tl','tr',
  'uz','vi','cy','yo','zu','pt-BR',
])

async function myMemoryTranslate(text, sourceLang, targetLang) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
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
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
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
//   1. Google Translate unofficial (no key, all scripts, very reliable)
//   2. MyMemory (Latin targets only — non-Latin returns transliterations)
//   3. Lingva (last resort)

async function translateChunk(chunk, sourceLang, targetLang) {
  const tgtBase = targetLang.split('-')[0]
  const isNonLatinTarget = !LATIN_LANG_CODES.has(tgtBase)

  // Try Google first (always — handles all scripts perfectly)
  try {
    const result = await googleTranslate(chunk, sourceLang, targetLang)
    // Sanity check: result should differ from input (except for very short strings)
    if (chunk.length > 20 && result.trim() === chunk.trim()) {
      throw new Error('Identity: translation equals source')
    }
    return result
  } catch (googleErr) {
    // Google failed — fall through to next option
    console.warn('[translate] Google failed:', googleErr.message)
  }

  // Non-Latin targets: skip MyMemory (returns Latin transliterations)
  if (!isNonLatinTarget) {
    try {
      const result = await myMemoryTranslate(chunk, sourceLang, targetLang)
      if (chunk.length > 20 && result.trim() === chunk.trim()) {
        throw new Error('Identity translation')
      }
      return result
    } catch (mmErr) {
      if (mmErr.message !== 'QUOTA_EXCEEDED' && mmErr.message !== 'Identity translation') {
        console.warn('[translate] MyMemory failed:', mmErr.message)
      }
    }
  }

  // Last resort: Lingva
  return lingvaTranslate(chunk, sourceLang, targetLang)
}

// ─── Post-translation cleaning ─────────────────────────────────────────────

function cleanTranslatedText(text) {
  return text
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function translateText(text, sourceLang, targetLang, onProgress) {
  if (!text?.trim()) return ''

  const srcBase = sourceLang.split('-')[0].toLowerCase()
  const tgtBase = targetLang.split('-')[0].toLowerCase()
  if (srcBase !== 'auto' && srcBase === tgtBase) return text

  const chunks     = splitIntoChunks(text)
  const translated = []

  for (let i = 0; i < chunks.length; i++) {
    const result = await translateChunk(chunks[i], sourceLang, targetLang)
    translated.push(result)
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100))
    if (i < chunks.length - 1) await sleep(DELAY_MS)
  }

  return cleanTranslatedText(translated.join(' '))
}
