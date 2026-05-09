const CHUNK_SIZE = 450
const DELAY_MS = 300

// Lingva Translate — fallback gratuit, sans clé API
const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
]

// Codes de langues utilisant l'alphabet latin (pas besoin de vérification de script)
const LATIN_LANG_CODES = new Set([
  'af', 'sq', 'az', 'bs', 'ca', 'hr', 'cs', 'da', 'nl', 'en', 'et',
  'fi', 'fr', 'de', 'ht', 'hu', 'id', 'it', 'lv', 'lt', 'ms', 'no',
  'pl', 'pt', 'ro', 'sk', 'sl', 'so', 'es', 'sw', 'sv', 'tl', 'tr',
  'uz', 'vi', 'cy', 'yo', 'zu', 'pt-BR',
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
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const data = await res.json()
      if (data.translation) return data.translation
    } catch (_) { /* essayer instance suivante */ }
  }
  throw new Error('Lingva indisponible sur toutes les instances')
}

// ─── Traduction d'un chunk (MyMemory → Lingva) ────────────────────────────

async function translateChunk(chunk, sourceLang, targetLang) {
  try {
    return await translateChunkMyMemory(chunk, sourceLang, targetLang)
  } catch (err) {
    if (err.message === 'QUOTA_EXCEEDED' || err.message.startsWith('MyMemory')) {
      return await translateChunkLingva(chunk, sourceLang, targetLang)
    }
    throw err
  }
}

// ─── Vérification post-traduction ─────────────────────────────────────────

/**
 * Pour les langues à script non-latin (Tamil, Hindi, Arabe…), vérifie que
 * le texte traduit ne contient pas de phrases encore en français/anglais.
 * Re-traduit automatiquement les parties non traduites.
 */
async function verifyAndFix(text, targetLang) {
  const base = targetLang.split('-')[0]
  if (LATIN_LANG_CODES.has(base) || LATIN_LANG_CODES.has(targetLang)) return text

  // Découper en lignes/paragraphes et vérifier chacun
  const segments = text.split('\n')
  const fixed = []

  for (const seg of segments) {
    const trimmed = seg.trim()
    if (!trimmed) { fixed.push(seg); continue }

    const latinLetters = (trimmed.match(/[a-zA-ZÀ-ÿ]/g) || []).length
    const totalLetters = (trimmed.match(/\p{L}/gu) || []).length

    // Si plus de 50% des lettres sont latines → ce segment n'est pas traduit
    if (totalLetters > 0 && latinLetters / totalLetters > 0.50) {
      try {
        // Re-traduit avec Lingva en détection automatique de la langue source
        const retranslated = await translateChunkLingva(trimmed, 'auto', targetLang)
        fixed.push(retranslated)
      } catch {
        fixed.push(seg) // Garder l'original si ça échoue
      }
    } else {
      fixed.push(seg)
    }
  }

  return fixed.join('\n').trim()
}

// ─── Export principal ──────────────────────────────────────────────────────

/**
 * Traduit le texte de sourceLang vers targetLang.
 * - Primaire : MyMemory API
 * - Fallback : Lingva Translate
 * - Vérification : re-traduit les portions non traduites pour les scripts non-latins
 */
export async function translateText(text, sourceLang, targetLang, onProgress) {
  if (!text?.trim()) return ''

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

  const joined = translated.join(' ')

  // Vérification : s'assure que la sortie est entièrement dans la langue cible
  return await verifyAndFix(joined, targetLang)
}
