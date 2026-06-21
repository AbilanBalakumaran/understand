const CHUNK_SIZE = 450
const DELAY_MS   = 300

const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
]

/**
 * Latin-script language codes — verifyAndFix uses a looser heuristic for these
 * targets because we also need to catch source-language remnants.
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

// ─── MyMemory ─────────────────────────────────────────────────────────────

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

// ─── Lingva ───────────────────────────────────────────────────────────────

async function translateChunkLingva(chunk, sourceLang, targetLang) {
  const src = sourceLang === 'auto' ? 'auto' : sourceLang.split('-')[0]
  const tgt = targetLang.split('-')[0]
  for (const instance of LINGVA_INSTANCES) {
    try {
      const url = `${instance}/api/v1/${src}/${tgt}/${encodeURIComponent(chunk)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(12000) })
      if (!res.ok) continue
      const data = await res.json()
      if (data.translation) return data.translation
    } catch (_) {}
  }
  throw new Error('Lingva indisponible sur toutes les instances')
}

// ─── Per-chunk translation with retry ─────────────────────────────────────

async function translateChunk(chunk, sourceLang, targetLang, attempt = 0) {
  try {
    const result = await translateChunkMyMemory(chunk, sourceLang, targetLang)
    // Sanity: if result is identical to input and > 10 chars, assume failure
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
    // Retry once on network errors
    if (attempt === 0) {
      await sleep(500)
      return translateChunk(chunk, sourceLang, targetLang, 1)
    }
    throw err
  }
}

// ─── Post-translation verification ────────────────────────────────────────

/**
 * Ensures the translated text is fully in the target language.
 *
 * For non-Latin targets (Tamil, Hindi, Arabic …): re-translates any segment
 * that still contains > 35 % Latin letters.
 *
 * For Latin targets: re-translates any segment that appears to be identical
 * to the source (common when MyMemory gives back an untranslated chunk).
 */
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
      // For non-Latin targets: flag segments with too many Latin letters
      const latinLetters = (trimmed.match(/[a-zA-ZÀ-ÿ]/g) || []).length
      const totalLetters = (trimmed.match(/\p{L}/gu) || []).length
      // Lowered threshold: 35 % (was 50 %) — catches more remnants
      if (totalLetters > 0 && latinLetters / totalLetters > 0.35) {
        needsRetranslation = true
      }
    } else if (srcBase) {
      // For Latin targets: check if the segment looks like it was NOT translated
      // by scoring it against source-language stop words
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
          // If the translated segment strongly matches the SOURCE language → flag it
          if (sourceScore >= 3) needsRetranslation = true
        }
      }
    }

    if (needsRetranslation) {
      try {
        const retranslated = await translateChunkLingva(trimmed, 'auto', targetLang)
        // Only use retranslated if it actually changed
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

/**
 * Translates text from sourceLang to targetLang.
 * Primary: MyMemory  |  Fallback: Lingva  |  Verification: verifyAndFix
 *
 * @param {string}   text
 * @param {string}   sourceLang  - BCP-47 / MyMemory code (e.g. 'fr', 'en')
 * @param {string}   targetLang  - BCP-47 code (e.g. 'ta', 'hi', 'ar')
 * @param {Function} onProgress  - callback 0-100 (translation phase only)
 */
export async function translateText(text, sourceLang, targetLang, onProgress) {
  if (!text?.trim()) return ''

  const srcBase = sourceLang.split('-')[0].toLowerCase()
  const tgtBase = targetLang.split('-')[0].toLowerCase()
  if (srcBase === tgtBase) return text

  const chunks     = splitIntoChunks(text)
  const translated = []

  for (let i = 0; i < chunks.length; i++) {
    const result = await translateChunk(chunks[i], sourceLang, targetLang)
    translated.push(result)
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100))
    if (i < chunks.length - 1) await sleep(DELAY_MS)
  }

  const joined = translated.join(' ')

  // Post-translation verification pass
  return await verifyAndFix(joined, sourceLang, targetLang)
}
