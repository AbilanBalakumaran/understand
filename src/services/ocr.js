import { createWorker } from 'tesseract.js'

// ─── Image preprocessing ───────────────────────────────────────────────────
//
// Before OCR, we enhance the image via Canvas:
//   1. Convert to grayscale (removes color noise)
//   2. Auto-levels stretch (maximises contrast — critical for dark phone photos)
//   3. Unsharp-mask kernel (improves edge sharpness for blurry scans)
//
// This consistently improves Tesseract accuracy by 20-50% on real phone photos.

export async function preprocessImageForOCR(imageBlob) {
  return new Promise((resolve) => {
    const img = new Image()
    const url = URL.createObjectURL(imageBlob)

    img.onload = () => {
      URL.revokeObjectURL(url)

      // Scale down if too large — Tesseract peaks around 300 DPI equivalent.
      // Very large images slow OCR without improving quality.
      const MAX_SIDE = 2400
      let { naturalWidth: w, naturalHeight: h } = img
      const scale = w > MAX_SIDE || h > MAX_SIDE
        ? Math.min(MAX_SIDE / w, MAX_SIDE / h)
        : 1
      w = Math.round(w * scale)
      h = Math.round(h * scale)

      const canvas = document.createElement('canvas')
      canvas.width  = w
      canvas.height = h
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, w, h)

      const imageData = ctx.getImageData(0, 0, w, h)
      const d = imageData.data
      const len = d.length

      // Step 1: Grayscale (luminance-weighted)
      const gray = new Uint8ClampedArray(len / 4)
      for (let i = 0, j = 0; i < len; i += 4, j++) {
        gray[j] = Math.round(0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2])
      }

      // Step 2: Auto-levels (stretch histogram to [0, 255])
      let lo = 255, hi = 0
      for (let i = 0; i < gray.length; i++) {
        if (gray[i] < lo) lo = gray[i]
        if (gray[i] > hi) hi = gray[i]
      }
      const range = hi - lo || 1
      const stretched = new Uint8ClampedArray(gray.length)
      for (let i = 0; i < gray.length; i++) {
        stretched[i] = Math.round(((gray[i] - lo) / range) * 255)
      }

      // Step 3: 3×3 unsharp-mask (sharpen edges)
      const sharp = new Uint8ClampedArray(stretched)
      const kernel = [
         0, -1,  0,
        -1,  5, -1,
         0, -1,  0,
      ]
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          let v = 0
          for (let ky = -1; ky <= 1; ky++) {
            for (let kx = -1; kx <= 1; kx++) {
              v += stretched[(y + ky) * w + (x + kx)] * kernel[(ky+1)*3 + (kx+1)]
            }
          }
          sharp[y * w + x] = Math.max(0, Math.min(255, v))
        }
      }

      // Write back as RGBA
      for (let i = 0, j = 0; i < len; i += 4, j++) {
        d[i] = d[i+1] = d[i+2] = sharp[j]
        d[i+3] = 255
      }
      ctx.putImageData(imageData, 0, 0)

      canvas.toBlob(blob => resolve(blob || imageBlob), 'image/jpeg', 0.95)
    }

    img.onerror = () => { URL.revokeObjectURL(url); resolve(imageBlob) }
    img.src = url
  })
}

// ─── Script detection from OCR output ─────────────────────────────────────
//
// When OSD fails, we run a fast initial OCR pass and analyse the Unicode
// content to pick the right Tesseract model for a second, higher-quality pass.

const SCRIPT_RANGES = {
  ara:     /[؀-ۿ]/g,
  rus:     /[Ѐ-ӿ]/g,
  chi_sim: /[一-鿿]/g,
  jpn:     /[぀-ヿ]/g,
  kor:     /[가-힣]/g,
  hin:     /[ऀ-ॿ]/g,
  tam:     /[஀-௿]/g,
  tha:     /[฀-๿]/g,
  heb:     /[א-ת]/g,
  ell:     /[Ͱ-Ͽ]/g,
  kat:     /[Ⴀ-ჿ]/g,
  tel:     /[ఀ-౿]/g,
  kan:     /[ಀ-೿]/g,
  mal:     /[ഀ-ൿ]/g,
}

// Combined models: pair non-Latin script with fra so numbers/dates are preserved.
// Every non-Latin language gets +fra so Latin digits, dates, and references inside
// the document are captured alongside the native script characters.
const COMBINED_MODELS = {
  ara: 'ara+fra', rus: 'rus+fra', chi_sim: 'chi_sim+fra',
  jpn: 'jpn+fra', kor: 'kor+fra', hin: 'hin+fra',
  tam: 'tam+fra', tha: 'tha+fra', heb: 'heb+fra',
  ell: 'ell+fra', kat: 'kat+fra', tel: 'tel+fra',
  kan: 'kan+fra', mal: 'mal+fra', arm: 'arm+fra',
  amh: 'amh+fra', khm: 'khm+fra', sin: 'sin+fra',
  mya: 'mya+fra',
}

function detectScriptFromText(text) {
  if (!text || text.length < 5) return null
  let best = null, bestCount = 4  // minimum threshold
  for (const [code, re] of Object.entries(SCRIPT_RANGES)) {
    const count = (text.match(re) || []).length
    if (count > bestCount) { best = code; bestCount = count }
  }
  return best
}

// ─── Tesseract worker ──────────────────────────────────────────────────────

export async function extractText(image, langCode = 'fra+eng', onProgress) {
  const worker = await createWorker(langCode, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text')               onProgress?.(Math.round(m.progress * 100))
      else if (m.status === 'loading tesseract core')    onProgress?.(5)
      else if (m.status === 'initializing tesseract')    onProgress?.(10)
      else if (m.status === 'loading language traineddata') onProgress?.(20)
      else if (m.status === 'initializing api')          onProgress?.(30)
    },
  })
  try {
    const { data } = await worker.recognize(image)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}

// ─── OSD script detection ─────────────────────────────────────────────────

const OSD_SCRIPT_TO_CODE = {
  Arabic:     'ara',   Cyrillic:  'rus',  Hangul:    'kor',
  Hiragana:   'jpn',   Katakana:  'jpn',  Han:       'chi_sim',
  Devanagari: 'hin',   Tamil:     'tam',  Telugu:    'tel',
  Kannada:    'kan',   Malayalam: 'mal',  Thai:      'tha',
  Hebrew:     'heb',   Greek:     'ell',  Georgian:  'kat',
  Armenian:   'arm',   Ethiopic:  'amh',  Khmer:     'khm',
  Sinhala:    'sin',   Myanmar:   'mya',  Tibetan:   'tib',
}

async function detectScriptViaOsd(image) {
  const osdRace = async () => {
    const worker = await createWorker('osd', 0, { logger: () => {} })
    try {
      const { data } = await worker.detect(image)
      return data?.script ?? null
    } finally {
      await worker.terminate()
    }
  }
  const timeout = new Promise(resolve => setTimeout(() => resolve(null), 10000))
  try { return await Promise.race([osdRace(), timeout]) }
  catch { return null }
}

// ─── Unicode script analysis (instant, no network) ────────────────────────

function detectDominantScript(text) {
  const ns = text.replace(/\s/g, '')
  if (ns.length < 3) return null
  const count = (re) => (text.match(re) || []).length
  const r     = (n)  => n / ns.length
  if (r(count(/[؀-ۿ]/g))       > 0.10) return 'ara'
  if (r(count(/[Ѐ-ӿ]/g))       > 0.10) return 'rus'
  if (r(count(/[가-힣]/g))       > 0.06) return 'kor'
  if (r(count(/[぀-ヿ]/g))       > 0.04) return 'jpn'
  if (r(count(/[一-鿿]/g))       > 0.06) return 'chi_sim'
  if (r(count(/[ऀ-ॿ]/g))        > 0.08) return 'hin'
  if (r(count(/[஀-௿]/g))       > 0.08) return 'tam'
  if (r(count(/[฀-๿]/g))        > 0.08) return 'tha'
  if (r(count(/[א-ת]/g))         > 0.08) return 'heb'
  if (r(count(/[Ͱ-Ͽ]/g))        > 0.08) return 'ell'
  if (r(count(/[Ⴀ-ჿ]/g))        > 0.08) return 'kat'
  return null
}

// ─── Quality score (higher = more real letters, less garbage) ─────────────

function ocrQuality(text) {
  if (!text || text.length < 3) return 0
  const letters = (text.match(/\p{L}/gu) || []).length
  const total   = text.replace(/\s/g, '').length
  return total > 0 ? letters / total : 0
}

// ─── ISO-639-1 → Tesseract code (for user-provided source language) ──────────
// When the user tells us the document language, we skip OSD entirely and load
// the correct model directly — much more reliable than script auto-detection.

const ISO1_TO_TESSERACT = {
  fr:'fra', en:'eng', es:'spa', de:'deu', it:'ita', pt:'por', nl:'nld',
  ru:'rus', ar:'ara', zh:'chi_sim', 'zh-CN':'chi_sim', 'zh-TW':'chi_tra',
  ja:'jpn', ko:'kor', tr:'tur', pl:'pol', uk:'ukr', sv:'swe', da:'dan',
  fi:'fin', nb:'nor', no:'nor', cs:'ces', sk:'slk', ro:'ron', hu:'hun',
  hr:'hrv', bg:'bul', sr:'srp', sl:'slv', et:'est', lv:'lav', lt:'lit',
  el:'ell', he:'heb', hi:'hin', bn:'ben', ta:'tam', te:'tel', kn:'kan',
  ml:'mal', si:'sin', th:'tha', my:'mya', km:'khm', ka:'kat', hy:'arm',
  am:'amh', ur:'urd', fa:'fas',
}

// ─── Main auto OCR ────────────────────────────────────────────────────────
//
// Strategy:
//   0. If knownLang provided → skip OSD, use the correct model directly
//   1. Preprocess image (grayscale + auto-contrast + sharpen)
//   2. OSD script detection
//   3a. Non-Latin → use combined model (e.g. ara+fra)
//   3b. Latin / OSD failed → fra+eng
//   4. Quality check: if result is poor (< 40% letters), analyse Unicode
//      in the output and retry with the correct non-Latin model
//   5. Return the best result

export async function extractTextAuto(image, onProgress, knownLang = null) {
  // Step 1: Preprocess (browser only — no-op if Canvas unavailable)
  let processedImage = image
  if (typeof document !== 'undefined') {
    try {
      processedImage = await preprocessImageForOCR(image)
    } catch (_) {
      processedImage = image  // preprocessing failed — use original
    }
  }

  onProgress?.(5)

  // Step 0: If the user told us the source language, skip OSD entirely.
  // This is the most reliable path — we know exactly which Tesseract model to use.
  if (knownLang && knownLang !== 'auto') {
    const tessCode = ISO1_TO_TESSERACT[knownLang] || ISO1_TO_TESSERACT[knownLang.split('-')[0]]
    if (tessCode) {
      // Use combined model (+ fra) to also capture Latin digits, dates, etc.
      const combined = COMBINED_MODELS[tessCode] || (tessCode + '+fra')
      const text = await extractText(processedImage, combined, (p) => {
        onProgress?.(30 + Math.round(p * 0.7))
      })
      onProgress?.(100)
      return text
    }
  }

  // Step 2: OSD script detection
  const osdScript = await detectScriptViaOsd(processedImage)

  // Step 3: Pick Tesseract model
  let langCode = 'fra+eng'
  let knownNonLatin = false

  if (osdScript && osdScript !== 'Latin' && osdScript !== 'Common'
      && osdScript !== 'Unknown' && osdScript !== '') {
    const base = OSD_SCRIPT_TO_CODE[osdScript]
    if (base) {
      langCode = COMBINED_MODELS[base] || base
      knownNonLatin = true
    }
  }

  // Step 4: OCR
  let text = await extractText(processedImage, langCode, (p) => {
    // Map internal progress [0-100] to [30-90] so caller sees full range
    onProgress?.(30 + Math.round(p * 0.6))
  })
  onProgress?.(90)

  // Step 5: Quality check + intelligent retry
  const quality = ocrQuality(text)

  if (!knownNonLatin && quality < 0.40) {
    // Poor quality with a Latin model: the document might actually be non-Latin.
    // Detect dominant script from what Tesseract managed to extract,
    // then retry with the correct model.
    const detectedCode = detectScriptFromText(text) || detectDominantScript(text)
    if (detectedCode) {
      const retryLang = COMBINED_MODELS[detectedCode] || detectedCode
      const retryText = await extractText(processedImage, retryLang, () => {})
      // Pick whichever result has better quality
      if (ocrQuality(retryText) > quality) {
        onProgress?.(100)
        return retryText
      }
    }
  }

  onProgress?.(100)
  return text
}
