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
 * Maps Tesseract OSD script names → SOURCE_LANGUAGES codes for non-Latin scripts.
 */
const SCRIPT_TO_LANG = {
  arabic:      'ara',
  cyrillic:    'rus',
  han:         'chi_sim',
  hiragana:    'jpn',
  katakana:    'jpn',
  hangul:      'kor',
}

/**
 * Extended stop-word lists per language.
 * Unaccented variants included so OCR errors with the English model don't break matching.
 */
const LANG_MARKERS = {
  fra: [
    'le','la','les','un','une','du','des','et','en','est','pas','qui','que',
    'au','aux','pour','dans','sur','avec','mais','plus','tout','cette','vous',
    'nous','ils','son','par','ont','ces','je','tu','il','elle','même','aussi',
    'bien','comme','si','car','ou','donc','leur','leurs','très','ça','être',
  ],
  eng: [
    'the','is','are','and','to','of','in','a','that','it','was','for','on',
    'with','this','from','not','or','by','be','at','have','an','we','he',
    'she','they','his','her','as','do','but','all','if','its','so','been',
    'were','has','had','would','could','should','will','our','their','there',
  ],
  spa: [
    'el','los','las','del','con','por','una','este','esta','como','pero',
    'que','sus','ser','cuando','donde','más','años','para','muy','todo',
    'sin','entre','cada','sobre','hasta','lo','se','le','en','al','hay',
    'mi','tu','su','nos','les','son','han','fue','era','es',
  ],
  deu: [
    'der','die','das','ein','eine','und','ist','zu','mit','auf','fur','fuer',
    'dass','aber','sich','nicht','von','den','dem','des','bei','werden',
    'haben','nach','oder','auch','wenn','wird','im','am','aus','an','es',
    'ich','wir','sie','er','hat','war','wie','so','noch','nur','als',
  ],
  ita: [
    'il','lo','gli','una','dei','con','per','sono','come','anche','dalla',
    'nella','dello','questo','hanno','alla','che','del','nel','non','più',
    'tutti','dove','quando','molto','ma','se','io','tu','lui','lei','noi',
    'era','sta','sua','suo','le','la','un','di','da','in','ed','si',
  ],
  por: [
    'uma','dos','das','com','por','são','seu','sua','como','mas','pelo',
    'pela','para','que','nao','mais','seus','suas','todo','este','esta',
    'ele','ela','nos','eles','ao','na','no','se','te','me','lhe','foi',
    'tem','ser','ter','foi','isso','aqui','há','já','bem','um',
  ],
  nld: [
    'de','het','een','van','en','in','is','dat','op','te','met','niet',
    'zijn','aan','ook','was','voor','bij','er','maar','als','heeft','worden',
    'om','ze','we','hij','zijn','haar','hun','ze','dit','tot','al','nog',
  ],
  pol: [
    'się','nie','jest','jak','co','to','na','tak','ale','już','czy','po',
    'do','ze','ten','który','tego','tym','jego','jej','tylko','to','i',
    'w','z','na','że','się','jest','go','ma','jej','tu','tak','czy',
  ],
  tur: [
    'bir','ve','bu','da','de','için','ile','ne','ben','sen','var',
    'olan','daha','çok','gibi','kadar','bu','bir','de','da','en',
    'ile','ki','mi','bu','o','ise','bu','onlar','biz','siz',
  ],
  rus: [
    'и','в','не','на','я','что','с','по','это','он','она','они',
    'мы','вы','как','но','из','за','то','его','её','их','нет',
  ],
}

/**
 * Score text against all known language stop-word lists.
 * Returns the best-matching language code or null if ambiguous.
 */
function detectLatinLanguage(text) {
  const words = text.toLowerCase()
    .match(/\b[a-zàâäçéèêëîïôùûüœæßąćęłńóśźżřšžáéíóúìòñ]{2,}\b/g) || []

  // Also add unaccented tokens for robustness against OCR errors
  const ascii = text.toLowerCase().match(/\b[a-z]{2,}\b/g) || []
  const wordSet = new Set([...words, ...ascii])

  if (wordSet.size < 4) return null

  const scores = {}
  for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
    scores[lang] = markers.filter(w => wordSet.has(w)).length
  }

  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)
  const [best, bestScore] = sorted[0]
  const [, secondScore]   = sorted[1] || [null, 0]

  // Need at least 2 markers and a clear lead over second place
  if (bestScore < 2) return null
  if (bestScore === secondScore && bestScore < 5) return null

  // Don't report Russian if no Cyrillic was found in text (OCR artefact)
  if (best === 'rus') return null

  return best
}

/**
 * Attempts to detect the source language of a document image.
 *
 * Strategy:
 *  1. Run Tesseract OSD to detect the writing script (Latin, Arabic, Cyrillic…).
 *  2. Non-Latin scripts are mapped directly to a language code.
 *  3. For Latin scripts: run a quick OCR pass with the English model and
 *     identify the specific language via stop-word frequency analysis.
 *
 * @param  {File|Blob|string} image
 * @returns {Promise<string|null>}  SOURCE_LANGUAGES code or null
 */
export async function detectImageLanguage(image) {
  // ── Step 1: Script detection via OSD ──────────────────────────────────────
  let osdWorker = null
  let detectedScript = null

  try {
    osdWorker = await createWorker('osd', 1, { logger: () => {} })
    const { data } = await osdWorker.detect(image)
    const script = (data?.script || '').toLowerCase()
    const conf   = data?.scriptConfidence ?? 0

    if (script && conf > 25) {
      detectedScript = script

      // Map directly for unambiguous non-Latin scripts
      const directLang = SCRIPT_TO_LANG[script]
      if (directLang) return directLang

      // Cyrillic with lower confidence → Russian
      if (script === 'cyrillic') return 'rus'
    }
  } catch {
    // OSD traineddata not available — fall through to OCR-based detection
  } finally {
    try { await osdWorker?.terminate() } catch {}
  }

  // ── Step 2: Latin script → stop-word analysis via OCR ────────────────────
  let worker = null
  try {
    worker = await createWorker('eng', 1, { logger: () => {} })
    const { data } = await worker.recognize(image)

    // Relax confidence threshold — Latin languages score lower when OCR'd with
    // an English-trained model, but the text is still readable for stop-word analysis.
    if (data.confidence < 32) return null

    const text     = data.text
    const nonSpace = text.replace(/\s/g, '')
    if (nonSpace.length < 8) return null

    // If OSD detected Latin but we got here, check Latin ratio as guard
    const latinCount = (nonSpace.match(
      /[a-zA-ZàâäçéèêëîïôùûüœæßąćęłńóśźżřšžáéíóúìòñÀÂÄÇÉÈÊËÎÏÔÙÛÜŒÆ]/g
    ) || []).length

    if (latinCount / nonSpace.length < 0.50) return null

    return detectLatinLanguage(text)
  } catch {
    return null
  } finally {
    try { await worker?.terminate() } catch {}
  }
}
