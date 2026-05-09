const CHUNK_SIZE = 450 // characters per API call (MyMemory limit: 500)
const DELAY_MS = 300   // small delay between chunks to avoid rate-limiting

// Lingva Translate public instances (fallback when MyMemory quota exceeded)
const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
]

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * Split text into chunks without breaking words.
 */
function splitIntoChunks(text) {
  if (text.length <= CHUNK_SIZE) return [text]

  const chunks = []
  let start = 0

  while (start < text.length) {
    let end = start + CHUNK_SIZE
    if (end >= text.length) {
      chunks.push(text.slice(start))
      break
    }
    // Try to break at a sentence boundary first, then a word boundary
    const sliceText = text.slice(start, end)
    const lastSentence = Math.max(
      sliceText.lastIndexOf('. '),
      sliceText.lastIndexOf('.\n'),
      sliceText.lastIndexOf('! '),
      sliceText.lastIndexOf('? ')
    )
    const lastSpace = sliceText.lastIndexOf(' ')
    const breakAt = lastSentence > CHUNK_SIZE * 0.5
      ? lastSentence + 1
      : lastSpace > 0
        ? lastSpace
        : CHUNK_SIZE

    chunks.push(text.slice(start, start + breakAt).trim())
    start += breakAt
  }
  return chunks.filter((c) => c.length > 0)
}

/**
 * Translate a single chunk via MyMemory API.
 * Throws if quota exceeded or translation failed.
 */
async function translateChunkMyMemory(chunk, sourceLang, targetLang) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${sourceLang}|${targetLang}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`MyMemory HTTP error: ${res.status}`)
  const data = await res.json()

  // Detect quota exceeded (MyMemory returns this silently with status 200)
  if (data.quotaFinished === true) {
    throw new Error('QUOTA_EXCEEDED')
  }
  const translated = data.responseData?.translatedText ?? ''
  if (translated.includes('MYMEMORY WARNING') || translated.includes('YOU USED ALL AVAILABLE')) {
    throw new Error('QUOTA_EXCEEDED')
  }
  if (data.responseStatus !== 200) {
    throw new Error(`MyMemory error: ${data.responseDetails || data.responseStatus}`)
  }
  if (!translated) throw new Error('Empty response from MyMemory')
  return translated
}

/**
 * Translate a single chunk via Lingva Translate (fallback).
 */
async function translateChunkLingva(chunk, sourceLang, targetLang) {
  // Lingva uses base language codes (no region suffix)
  const src = sourceLang.split('-')[0]
  const tgt = targetLang.split('-')[0]

  for (const instance of LINGVA_INSTANCES) {
    try {
      const url = `${instance}/api/v1/${src}/${tgt}/${encodeURIComponent(chunk)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) continue
      const data = await res.json()
      if (data.translation) return data.translation
    } catch (_) {
      // Try next instance
    }
  }
  throw new Error('Lingva translation failed on all instances')
}

/**
 * Translate a single chunk: try MyMemory first, fall back to Lingva.
 */
async function translateChunk(chunk, sourceLang, targetLang) {
  try {
    return await translateChunkMyMemory(chunk, sourceLang, targetLang)
  } catch (err) {
    // If quota exceeded or MyMemory failed, try Lingva
    if (err.message === 'QUOTA_EXCEEDED' || err.message.startsWith('MyMemory')) {
      return await translateChunkLingva(chunk, sourceLang, targetLang)
    }
    throw err
  }
}

/**
 * Translate text from sourceLang to targetLang.
 * Primary: MyMemory API. Fallback: Lingva Translate.
 * @param {string} text
 * @param {string} sourceLang - e.g. 'en'
 * @param {string} targetLang - e.g. 'ta', 'hi', 'ar'
 * @param {(progress: number) => void} onProgress - 0-100
 * @returns {Promise<string>}
 */
export async function translateText(text, sourceLang, targetLang, onProgress) {
  if (!text?.trim()) return ''

  // Same language — no translation needed
  const srcBase = sourceLang.split('-')[0].toLowerCase()
  const tgtBase = targetLang.split('-')[0].toLowerCase()
  if (srcBase === tgtBase) return text

  const chunks = splitIntoChunks(text)
  const translated = []

  for (let i = 0; i < chunks.length; i++) {
    const result = await translateChunk(chunks[i], sourceLang, targetLang)
    translated.push(result)
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100))
    if (i < chunks.length - 1) await sleep(DELAY_MS)
  }

  return translated.join(' ')
}
