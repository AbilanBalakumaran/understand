import { createWorker } from 'tesseract.js'
import { isPdf, extractPdfNativeText } from './pdf'

// ─── OCR text extraction ──────────────────────────────────────────────────────

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

function detectDominantScript(text) {
  const ns = text.replace(/\s/g, '')
  if (ns.length < 3) return null

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

// ─── Tesseract OSD — script detection ────────────────────────────────────────

async function detectScriptViaOsd(image) {
  try {
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

// ─── Multilingual auto OCR ────────────────────────────────────────────────────
//
// Strategy:
//   1. OSD: detect script in milliseconds (reliable for non-Latin scripts)
//   2a. Non-Latin script → use the exact Tesseract model (ara, hin, tam, etc.)
//   2b. Latin script → load fra+eng directly, no fragile language detection step
//
// We deliberately avoid tinyld-based detection for Latin scripts:
// the quick eng pass produces degraded text that confuses tinyld,
// which then loads the wrong model and makes OCR worse.
// fra+eng covers French and English (the most common cases) reliably
// and produces readable results for other Latin-script languages too.

export async function extractTextAuto(image, onProgress) {
  // OSD: fast script detection — reliable for non-Latin scripts
  const osdScript = await detectScriptViaOsd(image)

  if (
    osdScript &&
    osdScript !== 'Latin' &&
    osdScript !== 'Common' &&
    osdScript !== 'Unknown' &&
    osdScript !== ''
  ) {
    const code = OSD_SCRIPT_TO_CODE[osdScript]
    if (code) return extractText(image, code, onProgress)
  }

  // Latin (or OSD inconclusive): use fra+eng — fast, reliable, no detection step
  return extractText(image, 'fra+eng', onProgress)
}

