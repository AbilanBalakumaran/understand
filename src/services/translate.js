const CHUNK_SIZE = 450 // characters per API call (MyMemory limit: 500)
const DELAY_MS = 300   // small delay between chunks to avoid rate-limiting

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
 */
async function translateChunk(chunk, sourceLang, targetLang) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(chunk)}&langpair=${sourceLang}|${targetLang}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Translation request failed: ${res.status}`)
  const data = await res.json()
  if (data.responseStatus !== 200) {
    // Fall back to original chunk on error
    return chunk
  }
  return data.responseData?.translatedText || chunk
}

/**
 * Translate text from sourceLang to targetLang.
 * Uses MyMemory API (free, no API key required).
 * @param {string} text
 * @param {string} sourceLang - e.g. 'en'
 * @param {string} targetLang - e.g. 'fr'
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
