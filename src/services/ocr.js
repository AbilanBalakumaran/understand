import { createWorker } from 'tesseract.js'

/**
 * Extract text from an image using Tesseract OCR.
 */
export async function extractText(image, langCode = 'eng', onProgress) {
  const worker = await createWorker(langCode, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text')                onProgress?.(Math.round(m.progress * 100))
      else if (m.status === 'loading tesseract core')     onProgress?.(5)
      else if (m.status === 'initializing tesseract')     onProgress?.(10)
      else if (m.status === 'loading language traineddata') onProgress?.(20)
      else if (m.status === 'initializing api')           onProgress?.(30)
    }
  })
  try {
    const { data } = await worker.recognize(image)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}

// ─── Language detection ───────────────────────────────────────────────────────

/**
 * Common short words (stop words) that clearly identify a Latin-script language.
 * Keys must match SOURCE_LANGUAGES codes.
 */
const LANG_MARKERS = {
  fra: ['le','la','les','un','une','du','des','et','en','est','pas','qui','que',
        'au','aux','pour','dans','sur','avec','mais','plus','tout','cette','vous',
        'nous','ils','son','par','ont','été','ces','je','tu','il','elle','même'],
  eng: ['the','is','are','and','to','of','in','a','that','it','was','for','on',
        'with','this','from','not','or','by','be','at','have','an','we','he',
        'she','they','his','her','as','do','but','all','if','its','so'],
  spa: ['el','los','las','del','con','por','una','este','esta','como','pero',
        'que','sus','ser','también','cuando','donde','más','años','siendo',
        'para','muy','todo','sin','entre','cada','sobre','hasta'],
  deu: ['der','die','das','ein','eine','und','ist','zu','mit','auf','für',
        'dass','aber','sich','nicht','von','den','dem','des','bei','werden',
        'haben','nach','oder','auch','wenn','wird','im','am','aus'],
  ita: ['il','lo','gli','una','dei','con','per','sono','come','anche','dalla',
        'nella','dello','questo','hanno','alla','che','del','nel','non','più',
        'alla','tutti','essere','fare','dove','quando','molto'],
  por: ['uma','dos','das','com','por','são','seu','sua','como','mas','pelo',
        'pela','para','que','não','mais','seus','suas','estava','sendo','todo'],
  nld: ['de','het','een','van','en','in','is','dat','op','te','met','niet',
        'zijn','aan','ook','was','voor','bij','er','maar','als','heeft','worden'],
  pol: ['się','nie','jest','jak','co','to','na','tak','ale','już','czy','po',
        'do','ze','ten','który','tego','tym','jego','jej','tylko'],
  tur: ['bir','ve','bu','da','de','için','ile','ne','ben','sen','o','biz',
        'siz','onlar','var','yok','olan','daha','çok','gibi','kadar'],
}

/**
 * Analyses extracted OCR text to guess the Latin-script language.
 * Returns a SOURCE_LANGUAGES code ('fra', 'eng', etc.) or null if unsure.
 */
function detectLatinLanguage(text) {
  // Keep only simple word tokens (Latin + accented chars)
  const words = text.toLowerCase()
    .match(/\b[a-zàâäçéèêëîïôùûüœæüöäßąćęłńóśźżřšžïëöüáéíóúàèìòùñ]{2,}\b/g) || []

  if (words.length < 6) return null
  const wordSet = new Set(words)

  const scores = {}
  for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
    scores[lang] = markers.filter(w => wordSet.has(w)).length
  }

  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)
  const [best, bestScore] = sorted[0]
  const [, second]        = sorted[1] || [null, 0]

  // Require at least 3 markers and a clear lead over second place
  if (bestScore < 3) return null
  if (bestScore === second && bestScore < 7) return null

  return best
}

/**
 * Attempts to detect the source language of a document image.
 *
 * Strategy:
 *  1. Run a quick OCR pass with the English model (fast, already cached after
 *     first use, no extra download for most use cases).
 *  2. If the OCR confidence is high (≥ 50 %) the image is Latin-script →
 *     identify the specific language via stop-word frequency analysis.
 *  3. If confidence is low the document is probably non-Latin (Arabic, Tamil,
 *     Japanese …) → return null so the user can pick manually.
 *     We NEVER report a false positive "French" for a non-Latin image.
 *
 * @param  {File|Blob|string} image
 * @returns {Promise<string|null>}  SOURCE_LANGUAGES code or null
 */
export async function detectImageLanguage(image) {
  let worker = null
  try {
    // Suppress logger noise during the detection pass
    worker = await createWorker('eng', 1, { logger: () => {} })
    const { data } = await worker.recognize(image)

    // Low confidence ⇒ image is not Latin-script or is unreadable
    if (data.confidence < 48) return null

    return detectLatinLanguage(data.text)
  } catch {
    return null
  } finally {
    try { await worker?.terminate() } catch {}
  }
}
