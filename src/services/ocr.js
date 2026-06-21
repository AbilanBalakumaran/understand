import { createWorker } from 'tesseract.js'
import { detectAll as tinyldDetectAll } from 'tinyld'
import { isPdf, extractPdfNativeText } from './pdf'

// ─── OCR text extraction (main translation pipeline) ─────────────────────────

/**
 * Multilingual OCR — no source language needed from the user.
 * Internally detects the dominant script via OSD and picks the right
 * Tesseract model. Falls back to a broad Latin multi-language pack.
 */
export async function extractTextAuto(image, onProgress) {
  // Detect script first (fast, no full OCR)
  const osdScript = await detectScriptViaOsd(image)

  let langCode = 'eng+fra+deu+spa+ita+por+nld+pol+ces+ron+hun+tur'

  if (
    osdScript &&
    osdScript !== 'Latin' &&
    osdScript !== 'Common' &&
    osdScript !== 'Unknown' &&
    osdScript !== ''
  ) {
    const code = OSD_SCRIPT_TO_CODE[osdScript]
    if (code) langCode = code
  }

  return extractText(image, langCode, onProgress)
}

export async function extractText(image, langCode = 'eng', onProgress) {
  const worker = await createWorker(langCode, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text')              onProgress?.(Math.round(m.progress * 100))
      else if (m.status === 'loading tesseract core')   onProgress?.(5)
      else if (m.status === 'initializing tesseract')   onProgress?.(10)
      else if (m.status === 'loading language traineddata') onProgress?.(20)
      else if (m.status === 'initializing api')         onProgress?.(30)
    },
  })
  try {
    const { data } = await worker.recognize(image)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}

// ─── OSD script name → Tesseract lang code ───────────────────────────────────

const OSD_SCRIPT_TO_CODE = {
  Arabic:     'ara',
  Cyrillic:   'rus',
  Hangul:     'kor',
  Hiragana:   'jpn',
  Katakana:   'jpn',
  Han:        'chi_sim',
  Devanagari: 'hin',
  Tamil:      'tam',
  Telugu:     'tel',
  Kannada:    'kan',
  Malayalam:  'mal',
  Thai:       'tha',
  Hebrew:     'heb',
  Greek:      'ell',
  Georgian:   'kat',
  Armenian:   'arm',
  Ethiopic:   'amh',
  Khmer:      'khm',
  Sinhala:    'sin',
  Myanmar:    'mya',
  Tibetan:    'tib',
}

// ─── tinyld ISO 639-1 → Tesseract code ───────────────────────────────────────

const ISO1_TO_TESSERACT = {
  fr: 'fra',  en: 'eng',  es: 'spa',  de: 'deu',  it: 'ita',
  pt: 'por',  nl: 'nld',  ru: 'rus',  ar: 'ara',
  zh: 'chi_sim', ja: 'jpn', ko: 'kor', tr: 'tur',  pl: 'pol',
  uk: 'ukr',  sv: 'swe',  da: 'dan',  fi: 'fin',  nb: 'nor',
  no: 'nor',  cs: 'ces',  sk: 'slk',  ro: 'ron',  hu: 'hun',
  hr: 'hrv',  bg: 'bul',  sr: 'srp',  mk: 'mkd',  sl: 'slv',
  et: 'est',  lv: 'lav',  lt: 'lit',  el: 'ell',  he: 'heb',
  ca: 'cat',  eu: 'eus',  gl: 'glg',  af: 'afr',  id: 'ind',
  ms: 'msa',  tl: 'tgl',  vi: 'vie',  th: 'tha',
}

// ─── Unicode script analysis ──────────────────────────────────────────────────
// Covers non-Latin scripts reliably via character range counting.

function detectDominantScript(text) {
  const ns = text.replace(/\s/g, '')
  if (ns.length < 10) return null

  const count = (re) => (text.match(re) || []).length
  const r     = (n)  => n / ns.length

  const arabic    = count(/[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/g)
  const cyrillic  = count(/[Ѐ-ӿ]/g)
  const hangul    = count(/[가-힯]/g)
  const hiragana  = count(/[぀-ゟ]/g)
  const katakana  = count(/[゠-ヿ]/g)
  const cjk       = count(/[一-鿿㐀-䶿]/g)
  const devan     = count(/[ऀ-ॿ]/g)
  const tamil     = count(/[஀-௿]/g)
  const thai      = count(/[฀-๿]/g)
  const hebrew    = count(/[א-׿]/g)
  const greek     = count(/[Ͱ-Ͽ]/g)
  const georgian  = count(/[Ⴀ-ჿ]/g)
  const armenian  = count(/[԰-֏]/g)
  const ethiopic  = count(/[ሀ-፿]/g)
  const khmer     = count(/[ក-៿]/g)
  const sinhala   = count(/[඀-෿]/g)
  const myanmar   = count(/[က-႟]/g)
  const telugu    = count(/[ఀ-౿]/g)
  const kannada   = count(/[ಀ-೿]/g)
  const malayalam = count(/[ഀ-ൿ]/g)

  if (r(arabic)              > 0.10) return 'ara'
  if (r(cyrillic)            > 0.10) return 'rus'
  if (r(hangul)              > 0.06) return 'kor'
  if (r(hiragana + katakana) > 0.04) return 'jpn'
  if (r(cjk)                 > 0.06) return 'chi_sim'
  if (r(devan)               > 0.08) return 'hin'
  if (r(tamil)               > 0.08) return 'tam'
  if (r(thai)                > 0.08) return 'tha'
  if (r(hebrew)              > 0.08) return 'heb'
  if (r(greek)               > 0.08) return 'ell'
  if (r(georgian)            > 0.08) return 'kat'
  if (r(armenian)            > 0.08) return 'arm'
  if (r(ethiopic)            > 0.08) return 'amh'
  if (r(khmer)               > 0.08) return 'khm'
  if (r(sinhala)             > 0.08) return 'sin'
  if (r(myanmar)             > 0.08) return 'mya'
  if (r(telugu)              > 0.08) return 'tel'
  if (r(kannada)             > 0.08) return 'kan'
  if (r(malayalam)           > 0.08) return 'mal'

  return null
}

// ─── Chunk-based tinyld detection with majority vote ─────────────────────────

function detectLatinLanguage(text) {
  // Keep letters AND spaces — preserve sentence structure for accurate n-gram analysis.
  // Numbers and punctuation are removed only to avoid skewing trigrams.
  const cleaned = text
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  const letterCount = (cleaned.match(/\p{L}/gu) || []).length
  if (letterCount < 12) return null

  const len    = cleaned.length
  let   chunks

  if (len < 300) {
    chunks = [cleaned]
  } else {
    const size = Math.min(Math.floor(len / 3), 600)
    const mid  = Math.floor(len / 2)
    chunks = [
      cleaned.slice(0, size),
      cleaned.slice(mid - Math.floor(size / 2), mid + Math.floor(size / 2)),
      cleaned.slice(len - size),
    ].filter((c) => (c.match(/\p{L}/gu) || []).length >= 8)
  }

  const votes       = {}
  let   totalWeight = 0

  for (const chunk of chunks) {
    const results = tinyldDetectAll(chunk)
    if (!results.length) continue
    // Accept even low-accuracy detections — we aggregate across chunks
    const { lang, accuracy } = results[0]
    if (accuracy < 0.03) continue
    votes[lang]  = (votes[lang] || 0) + accuracy
    totalWeight += accuracy
  }

  if (!totalWeight) return null

  const sorted   = Object.entries(votes).sort(([, a], [, b]) => b - a)
  const [[bestLang, bestWeight]] = sorted
  const confidence    = bestWeight / totalWeight
  const tesseractCode = ISO1_TO_TESSERACT[bestLang]
  if (!tesseractCode) return null

  return { code: tesseractCode, confidence }
}

// ─── Tesseract OSD — script detection without full OCR ───────────────────────
// IMPORTANT: worker.detect() requires OEM=0 (Legacy), NOT OEM=1 (LSTM).

async function detectScriptViaOsd(image) {
  try {
    // OEM=0 → Tesseract Legacy engine, required by worker.detect()
    const worker = await createWorker('osd', 0, { logger: () => {} })
    try {
      const { data } = await worker.detect(image)
      return data?.script ?? null
    } finally {
      await worker.terminate()
    }
  } catch {
    return null
  }
}

// ─── Quick OCR for Latin text extraction ─────────────────────────────────────

async function runQuickOcr(image) {
  const worker = await createWorker('eng', 1, { logger: () => {} })
  try {
    const { data } = await worker.recognize(image)
    const ns = data.text.replace(/\s/g, '')
    if (data.confidence < 5 || ns.length < 8) return null
    return data.text
  } finally {
    await worker.terminate()
  }
}

// ─── Main language detection ──────────────────────────────────────────────────
// Returns { code: string, confidence: number } | null
//   code       — Tesseract language code ('fra', 'eng', 'chi_sim', …)
//   confidence — 0–1; values < 0.55 trigger a confirmation prompt in the UI

export async function detectImageLanguage(file) {
  try {

    // ── A. PDF with native text → extract directly, skip OCR ─────────────────
    if (file instanceof File && isPdf(file)) {
      const nativeText = await extractPdfNativeText(file)
      if (nativeText) {
        const scriptCode = detectDominantScript(nativeText)
        if (scriptCode) return { code: scriptCode, confidence: 0.93 }
        const result = detectLatinLanguage(nativeText)
        if (result) return result
      }
    }

    // ── B. OSD: detect script without full OCR (fast, reliable for non-Latin) ─
    //    Requires OEM=0 (Legacy engine) — this is the critical fix vs the
    //    previous OEM=1 build which silently crashed.
    const osdScript = await detectScriptViaOsd(file)
    if (
      osdScript &&
      osdScript !== 'Latin' &&
      osdScript !== 'Common' &&
      osdScript !== 'Unknown' &&
      osdScript !== ''
    ) {
      const code = OSD_SCRIPT_TO_CODE[osdScript]
      if (code) return { code, confidence: 0.90 }
    }

    // ── C. OCR pass with English model (Latin script or OSD unavailable) ──────
    const ocrText = await runQuickOcr(file)
    if (!ocrText) return null

    // ── D. Unicode analysis on OCR output ────────────────────────────────────
    //    Catches non-Latin chars that survived OCR (accents, diacritics, etc.)
    const scriptCode = detectDominantScript(ocrText)
    if (scriptCode) return { code: scriptCode, confidence: 0.85 }

    // ── E. Require minimum Latin character proportion ─────────────────────────
    const ns         = ocrText.replace(/\s/g, '')
    const latinCount = (ns.match(/[a-zA-ZÀ-ɏ]/g) || []).length
    if (latinCount / ns.length < 0.28) return null

    // ── F. tinyld chunk detection with majority vote ──────────────────────────
    return detectLatinLanguage(ocrText)

  } catch {
    return null
  }
}
