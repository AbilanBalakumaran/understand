import { createWorker } from 'tesseract.js'

/**
 * Extract text from an image using Tesseract OCR.
 * @param {File|Blob|string} image - image file or URL
 * @param {string} langCode - Tesseract language code (e.g. 'eng', 'fra')
 * @param {(progress: number) => void} onProgress - progress callback 0-100
 * @returns {Promise<string>}
 */
export async function extractText(image, langCode = 'eng', onProgress) {
  const worker = await createWorker(langCode, 1, {
    logger: (m) => {
      if (m.status === 'recognizing text') {
        onProgress?.(Math.round(m.progress * 100))
      } else if (m.status === 'loading tesseract core') {
        onProgress?.(5)
      } else if (m.status === 'initializing tesseract') {
        onProgress?.(10)
      } else if (m.status === 'loading language traineddata') {
        onProgress?.(20)
      } else if (m.status === 'initializing api') {
        onProgress?.(30)
      }
    }
  })

  try {
    const { data } = await worker.recognize(image)
    return data.text.trim()
  } finally {
    await worker.terminate()
  }
}
