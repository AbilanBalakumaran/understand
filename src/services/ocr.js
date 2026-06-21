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
    'nous','ils','son','par','ont','ces','je','tu','il','elle','meme','aussi',
    'bien','comme','si','car','ou','donc','leur','leurs','tres','ca','etre',
  ],
  eng: [
    'the','is','are','and','to','of','in','a','that','it','was','for','on',
    'with','this','from','not','or','by','be','at','have','an','we','he',
    'she','they','his','her','as','do','but','all','if','its','so','been',
    'were','has','had','would','could','should','will','our','their','there',
  ],
  spa: [
    'el','los','las','del','con','por','una','este','esta','como','pero',
    'que','sus','ser','cuando','donde','mas','anos','para','muy','todo',
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
    'nella','dello','questo','hanno','alla','che','del','nel','non','piu',
    'tutti','dove','quando','molto','ma','se','io','tu','lui','lei','noi',
    'era','sta','sua','suo','le','la','un','di','da','in','ed','si',
  ],
  por: [
    'uma','dos','das','com','por','sao','seu','sua','como','mas','pelo',
    'pela','para','que','nao','mais','seus','suas','todo','este','esta',
    'ele','ela','nos','eles','ao','na','no','se','te','me','lhe','foi',
    'tem','ser','ter','isso','aqui','ja','bem','um',
  ],
  nld: [
    'de','het','een','van','en','in','is','dat','op','te','met','niet',
    'zijn','aan','ook','was','voor','bij','er','maar','als','heeft','worden',
    'om','ze','we','hij','haar','hun','dit','tot','al','nog',
  ],
  pol: [
    'sie','nie','jest','jak','co','to','na','tak','ale','juz','czy','po',
    'do','ze','ten','ktory','tego','tym','jego','jej','tylko','i','w','z',
    'ze','go','ma','tu',
  ],
  tur: [
    'bir','ve','bu','da','de','icin','ile','ne','ben','sen','var',
    'olan','daha','cok','gibi','kadar','en','ki','mi','o','ise',
  ],
  rus: [
    'i','v','ne','na','ya','chto','s','po','eto','on','ona','oni',
    'my','vy','kak','no','iz','za','to','ego','ee','ih','net',
  ],
}

/**
 * Score text against all known language stop-word lists.
 */
function detectLatinLanguage(text) {
  const words = text.toLowerCase()
    .match(/\b[a-zÀ-ɏ]{2,}\b/g) || []

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

  if (bestScore < 2) return null
  if (bestScore === secondScore && bestScore < 5) return null
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
 */
export async function detectImageLanguage(image) {
  // ── Step 1: Script detection via OSD ──────────────────────────────────────
  let osdWorker = null

  try {
    osdWorker = await createWorker('osd', 1, { logger: () => {} })
    const { data } = await osdWorker.detect(image)
    const script = (data?.script || '').toLowerCase()
    const conf   = data?.scriptConfidence ?? 0

    if (script && conf > 25) {
      const directLang = SCRIPT_TO_LANG[script]
      if (directLang) return directLang
    }
  } catch {
    // OSD not available — fall through to OCR-based detection
  } finally {
    try { await osdWorker?.terminate() } catch {}
  }

  // ── Step 2: Latin script → stop-word analysis ─────────────────────────────
  let worker = null
  try {
    worker = await createWorker('eng', 1, { logger: () => {} })
    const { data } = await worker.recognize(image)

    if (data.confidence < 32) return null

    const text     = data.text
    const nonSpace = text.replace(/\s/g, '')
    if (nonSpace.length < 8) return null

    const latinCount = (nonSpace.match(
      /[a-zA-ZÀ-ɏ]/g
    ) || []).length

    if (latinCount / nonSpace.length < 0.50) return null

    return detectLatinLanguage(text)
  } catch {
    return null
  } finally {
    try { await worker?.terminate() } catch {}
  }
}
