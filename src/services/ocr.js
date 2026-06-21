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
 * Detect script family directly from Unicode character ranges in OCR text.
 * Avoids the OSD model entirely — more reliable for mixed or low-confidence docs.
 */
function detectScriptFromText(text) {
  const nonSpace = text.replace(/\s/g, '')
  if (nonSpace.length < 6) return null

  const count = (regex) => (text.match(regex) || []).length
  const ratio = (n) => n / nonSpace.length

  const arabic    = count(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g)
  const cyrillic  = count(/[Ѐ-ӿ]/g)
  const hangul    = count(/[가-힯]/g)
  const hiragana  = count(/[぀-ゟ]/g)
  const katakana  = count(/[゠-ヿ]/g)
  const cjk       = count(/[一-鿿㐀-䶿]/g)
  const devanagari= count(/[ऀ-ॿ]/g)
  const hebrew    = count(/[֐-׿]/g)
  const thai      = count(/[฀-๿]/g)

  if (ratio(arabic)    > 0.12) return 'ara'
  if (ratio(cyrillic)  > 0.12) return 'rus'
  if (ratio(hangul)    > 0.08) return 'kor'
  if (ratio(hiragana + katakana) > 0.06) return 'jpn'
  if (ratio(cjk)       > 0.08) return 'chi_sim'
  if (ratio(devanagari)> 0.08) return 'hin'  // not in SOURCE_LANGUAGES yet, but future-proof
  if (ratio(hebrew)    > 0.08) return null    // Hebrew not in source list
  if (ratio(thai)      > 0.08) return null    // Thai not in source list

  return null // Latin or undetermined — proceed to stop-word analysis
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
    'avez','avons','avoir','fait','faire','dit','voir','grand','petit','non',
  ],
  eng: [
    'the','is','are','and','to','of','in','a','that','it','was','for','on',
    'with','this','from','not','or','by','be','at','have','an','we','he',
    'she','they','his','her','as','do','but','all','if','its','so','been',
    'were','has','had','would','could','should','will','our','their','there',
    'which','who','what','when','where','how','can','may','just','about',
  ],
  spa: [
    'el','los','las','del','con','por','una','este','esta','como','pero',
    'que','sus','ser','cuando','donde','mas','anos','para','muy','todo',
    'sin','entre','cada','sobre','hasta','lo','se','le','en','al','hay',
    'mi','tu','su','nos','les','son','han','fue','era','es','del','algo',
    'bien','aqui','si','no','ya','yo','ellos','ellas','usted',
  ],
  deu: [
    'der','die','das','ein','eine','und','ist','zu','mit','auf','fur','fuer',
    'dass','aber','sich','nicht','von','den','dem','des','bei','werden',
    'haben','nach','oder','auch','wenn','wird','im','am','aus','an','es',
    'ich','wir','sie','er','hat','war','wie','so','noch','nur','als','sehr',
    'dann','durch','hier','bis','kann','mehr','man','noch','beim','zur',
  ],
  ita: [
    'il','lo','gli','una','dei','con','per','sono','come','anche','dalla',
    'nella','dello','questo','hanno','alla','che','del','nel','non','piu',
    'tutti','dove','quando','molto','ma','se','io','tu','lui','lei','noi',
    'era','sta','sua','suo','le','la','un','di','da','in','ed','si','hai',
    'abbiamo','essere','fare','cosa','bene','dopo','prima','ancora',
  ],
  por: [
    'uma','dos','das','com','por','sao','seu','sua','como','mas','pelo',
    'pela','para','que','nao','mais','seus','suas','todo','este','esta',
    'ele','ela','nos','eles','ao','na','no','se','te','me','lhe','foi',
    'tem','ser','ter','isso','aqui','ja','bem','um','eu','tu','voce',
    'muito','pode','fazer','grande','novo','outro','mesmo',
  ],
  nld: [
    'de','het','een','van','en','in','is','dat','op','te','met','niet',
    'zijn','aan','ook','was','voor','bij','er','maar','als','heeft','worden',
    'om','ze','we','hij','haar','hun','dit','tot','al','nog','naar','worden',
    'dan','meer','kan','hebben','worden','zo','want',
  ],
  pol: [
    'sie','nie','jest','jak','co','to','na','tak','ale','juz','czy','po',
    'do','ze','ten','ktory','tego','tym','jego','jej','tylko','i','w','z',
    'go','ma','tu','tego','tej','tych','tym','przez','przy','bez','pod',
    'nad','przed','za','po','od','do','ze','czy','bo','lub','ani',
  ],
  tur: [
    'bir','ve','bu','da','de','icin','ile','ne','ben','sen','var',
    'olan','daha','cok','gibi','kadar','en','ki','mi','o','ise',
    'bu','su','o','biz','siz','onlar','ama','ya','ile','hem','veya',
  ],
  rus: [
    'i','v','ne','na','ya','chto','s','po','eto','on','ona','oni',
    'my','vy','kak','no','iz','za','to','ego','ee','ih','net',
  ],
  ukr: [
    'i','v','ne','na','ya','shcho','z','po','tse','vin','vona','vony',
    'my','vy','yak','ale','iz','za','to','yoho','yiyi','yikh','ni',
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

  if (wordSet.size < 3) return null

  const scores = {}
  for (const [lang, markers] of Object.entries(LANG_MARKERS)) {
    scores[lang] = markers.filter(w => wordSet.has(w)).length
  }

  const sorted = Object.entries(scores).sort(([, a], [, b]) => b - a)
  const [best, bestScore] = sorted[0]
  const [, secondScore]   = sorted[1] || [null, 0]

  if (bestScore < 2) return null
  // Allow a tie only if both are very high (both score ≥ 5 means we pick the first)
  if (bestScore === secondScore && bestScore < 5) return null
  // Russian detection via stop-words is unreliable (transliteration noise)
  if (best === 'rus' || best === 'ukr') return null

  return best
}

/**
 * Map Tesseract stop-word lang codes → SOURCE_LANGUAGES codes
 */
const STOPWORD_TO_SOURCE = {
  fra: 'fra',
  eng: 'eng',
  spa: 'spa',
  deu: 'deu',
  ita: 'ita',
  por: 'por',
  nld: 'nld',
  pol: 'pol',
  tur: 'tur',
}

/**
 * Attempts to detect the source language of a document image.
 *
 * Strategy:
 *  1. Run a quick OCR pass with the English model to get raw text.
 *  2. Analyze Unicode character distribution to detect non-Latin scripts
 *     (Arabic, Cyrillic, CJK, Hangul, Hiragana…) without needing OSD.
 *  3. For Latin-script text: apply stop-word frequency analysis across
 *     10 languages.
 */
export async function detectImageLanguage(image) {
  let worker = null
  try {
    worker = await createWorker('eng', 1, { logger: () => {} })
    const { data } = await worker.recognize(image)

    // Accept even low-confidence OCR — non-Latin scripts will still
    // produce recognizable Unicode characters that we can count.
    if (data.confidence < 10) return null

    const text     = data.text
    const nonSpace = text.replace(/\s/g, '')
    if (nonSpace.length < 6) return null

    // Step 1: Unicode script detection (beats OSD for reliability)
    const scriptLang = detectScriptFromText(text)
    if (scriptLang) return scriptLang

    // Step 2: Latin-script stop-word analysis
    const latinCount = (nonSpace.match(/[a-zA-ZÀ-ɏ]/g) || []).length
    if (latinCount / nonSpace.length < 0.40) return null

    const detected = detectLatinLanguage(text)
    return detected ? (STOPWORD_TO_SOURCE[detected] || detected) : null
  } catch {
    return null
  } finally {
    try { await worker?.terminate() } catch {}
  }
}
