import { createWorker } from 'tesseract.js'

/**
 * Extract text from an image using Tesseract OCR.
 * @param {File|Blob|string} image    - image file or URL
 * @param {string}           langCode - Tesseract language code (e.g. 'eng', 'fra')
 * @param {Function}         onProgress - callback 0-100
 */
export async function extractText(image, langCode = 'eng', onProgress) {
  const worker = await createWorker(langCode, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text')           onProgress?.(Math.round(m.progress * 100))
      else if (m.status === 'loading tesseract core') onProgress?.(5)
      else if (m.status === 'initializing tesseract') onProgress?.(10)
      else if (m.status === 'loading language traineddata') onProgress?.(20)
      else if (m.status === 'initializing api')       onProgress?.(30)
    }
  })
  try {
    const { data } = await worker.recognize(image)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}

// ─── Script / Language detection ──────────────────────────────────────────────

/**
 * Maps Tesseract OSD script names to SOURCE_LANGUAGES codes.
 * null means the script is Latin — we default to French (most common use case).
 */
const OSD_SCRIPT_TO_CODE = {
  'Arabic':             'ara',
  'Chinese Simplified': 'chi_sim',
  'Chinese Traditional':'chi_sim',
  'Japanese':           'jpn',
  'Hangul':             'kor',
  'Cyrillic':           'rus',
  'Greek':              null,   // not in SOURCE_LANGUAGES — fall back
  'Hebrew':             null,
  'Devanagari':         null,   // Hindi not in SOURCE_LANGUAGES — fall back
  'Tamil':              null,
  'Thai':               null,
}

/**
 * Detects the script type of an image using Tesseract OSD.
 * Returns a SOURCE_LANGUAGES code (e.g. 'ara', 'fra', 'chi_sim') or null on failure.
 *
 * @param {File|Blob|string} image
 * @returns {Promise<string|null>}
 */
export async function detectImageLanguage(image) {
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('OSD timeout')), 8000)
  )

  try {
    const detect = (async () => {
      const worker = await createWorker('osd')
      try {
        const { data } = await worker.detect(image)
        return data.script || null
      } finally {
        await worker.terminate()
      }
    })()

    const script = await Promise.race([detect, timeout])
    if (!script) return null

    // Non-Latin scripts → direct mapping
    if (script in OSD_SCRIPT_TO_CODE) {
      return OSD_SCRIPT_TO_CODE[script] // could be null for unsupported scripts
    }

    // Latin (or unknown) → default to French
    return 'fra'
  } catch {
    return null
  }
}
