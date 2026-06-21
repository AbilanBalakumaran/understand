const CHUNK_SIZE = 450
const DELAY_MS   = 300

const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
  'https://lingva.thedaviddelta.com',
  'https://lingva.lunar.icu',
  'https://lingva.garudalinux.org',
]

/**
 * Latin-script language codes — non-Latin targets skip MyMemory entirely
 * because MyMemory returns transliterations (Latin letters) instead of
 * the native script for Arabic, Tamil, Hindi, etc.
 */
const LATIN_LANG_CODES = new Set([
  'af','sq','az','bs','ca','hr','cs','da','nl','en','et',
  'fi','fr','de','ht','hu','id','it','lv','lt','ms','no',
  'pl','pt','ro','sk','sl','so','es','sw','sv','tl','tr',
  'uz','vi','cy','yo','zu','pt-BR',
])

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

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
  return chunks.filter((c) => c.length > 0)
}

// ─── MyMemory (Latin targets only) ────────────────────────────────────────

async function translateChunkMyMemory(chunk, sourceLang, targetLang) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${sourceLang}|${targetLang}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`MyMemory HTTP ${res.status}`)
  const data = await res.json()
  if (data.quotaFinished === true) throw new Error('QUOTA_EXCEEDED')
  const translated = data.responseData?.translatedText ?? ''
  if (translated.includes('MYMEMORY WARNING') || translated.includes('YOU USED ALL AVAILABLE')) {
    throw new Error('QUOTA_EXCEEDED')
  }
  if (data.responseStatus !== 200) throw new Error(`MyMemory: ${data.responseDetails || data.responseStatus}`)
  if (!translated) throw new Error('Réponse vide de MyMemory')
  return translated
}

// ─── Lingva (all targets, tried in order) ─────────────────────────────────

async function translateChunkLingva(chunk, sourceLang, targetLang) {
  const src = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0]
  const tgt = targetLang.split('-')[0]
  const errors = []
  for (const instance of LINGVA_INSTANCES) {
    try {
      const url = `${instance}/api/v1/${src}/${tgt}/${encodeURIComponent(chunk)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(14000) })
      if (!res.ok) { errors.push(`${instance}: HTTP ${res.status}`); continue }
      const data = await res.json()
      if (data.translation) return data.translation
    } catch (e) {
      errors.push(`${instance}: ${e.message}`)
    }
  }
  throw new Error(`Traduction impossible — toutes les sources sont indisponibles. (${errors.slice(0,2).join(' / ')})`)
}

// ─── Per-chunk translation with retry ─────────────────────────────────────

async function translateChunk(chunk, sourceLang, targetLang, attempt = 0) {
  const tgtBase = targetLang.split('-')[0]
  const isNonLatinTarget = !LATIN_LANG_CODES.has(tgtBase)

  // Non-Latin targets (Arabic, Tamil, Hindi, Chinese…): always use Lingva.
  // MyMemory returns transliterated Latin text for these scripts.
  if (isNonLatinTarget) {
    return await translateChunkLingva(chunk, sourceLang, targetLang)
  }

  // Latin targets: try MyMemory first, fall back to Lingva
  try {
    const result = await translateChunkMyMemory(chunk, sourceLang, targetLang)
    if (result.trim() === chunk.trim() && chunk.length > 10) {
      throw new Error('Identity translation')
    }
    return result
  } catch (err) {
    const isQuota = err.message === 'QUOTA_EXCEEDED'
    const isFail  = err.message.startsWith('MyMemory') || err.message === 'Identity translation'
    if (isQuota || isFail) {
      return await translateChunkLingva(chunk, sourceLang, targetLang)
    }
    if (attempt === 0) {
      await sleep(500)
      return translateChunk(chunk, sourceLang, targetLang, 1)
    }
    throw err
  }
}

// ─── Post-translation cleaning ─────────────────────────────────────────────

/**
 * Strips invisible/control characters and normalises whitespace.
 * Does NOT touch letters, digits, punctuation, or native-script characters.
 */
function cleanTranslatedText(text) {
  return text
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[​-‏‪-‮⁠-⁤﻿]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── Post-translation verification ────────────────────────────────────────

async function verifyAndFix(text, sourceLang, targetLang) {
  const base = targetLang.split('-')[0]
  const isLatinTarget = LATIN_LANG_CODES.has(base) || LATIN_LANG_CODES.has(targetLang)
  const srcBase = sourceLang?.split('-')[0]?.toLowerCase()

  const segments = text.split('\n')
  const fixed = []

  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) { fixed.push(seg); continue }

    let needsRetranslation = false

    if (!isLatinTarget) {
      // Non-Latin target: flag segments that are still mostly Latin letters
      const latinLetters = (trimmed.match(/[a-zA-ZÀ-ÿ]/g) || []).length
      const totalLetters = (trimmed.match(/\p{L}/gu) || []).length
      if (totalLetters > 0 && latinLetters / totalLetters > 0.35) {
        needsRetranslation = true
      }
    } else if (srcBase) {
      const words = trimmed.toLowerCase().match(/\b[a-z]{2,}\b/g) || []
      if (words.length >= 4) {
        const SOURCE_STOPS = {
          fr: ['le','la','les','un','une','du','des','et','en','est','pas','qui','que','au'],
          en: ['the','is','are','and','of','in','a','that','it','for','on','with'],
          es: ['el','los','las','del','con','por','una','como','pero','que','ser'],
          de: ['der','die','das','ein','eine','und','ist','zu','mit','auf','für'],
          it: ['il','lo','gli','una','dei','con','per','sono','come','anche'],
          pt: ['uma','dos','das','com','por','são','seu','sua','como','mas'],
        }
        const stops = SOURCE_STOPS[srcBase] || []
        if (stops.length > 0) {
          const wordSet = new Set(words)
          const sourceScore = stops.filter(w => wordSet.has(w)).length
          if (sourceScore >= 3) needsRetranslation = true
        }
      }
    }

    if (needsRetranslation) {
      try {
        const retranslated = await translateChunkLingva(trimmed, 'auto', targetLang)
        fixed.push(retranslated !== trimmed ? retranslated : seg)
      } catch {
        fixed.push(seg)
      }
    } else {
      fixed.push(seg)
    }
  }

  return fixed.join('\n').trim()
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

  const joined  = translated.join(' ')
  const cleaned = cleanTranslatedText(joined)

  return await verifyAndFix(cleaned, sourceLang, targetLang)
}
