/**
 * PDF → image conversion via PDF.js (loaded from CDN on demand).
 * No npm bundle weight: the library is fetched only when a PDF is opened.
 */

let _pdfjsLib = null

async function loadPdfJs() {
  if (_pdfjsLib) return _pdfjsLib

  // Already loaded by a previous call
  if (window.pdfjsLib) {
    _pdfjsLib = window.pdfjsLib
    return _pdfjsLib
  }

  await new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'
    script.onload  = resolve
    script.onerror = () => reject(new Error('Impossible de charger PDF.js'))
    document.head.appendChild(script)
  })

  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js'

  _pdfjsLib = window.pdfjsLib
  return _pdfjsLib
}

/**
 * Renders all pages of a PDF into an array of JPEG Blobs.
 */
export async function convertPdfToImages(file, maxPages = 10, scale = 2) {
  const pdfjs       = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf         = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const total       = Math.min(pdf.numPages, maxPages)
  const blobs       = []

  for (let i = 1; i <= total; i++) {
    const page     = await pdf.getPage(i)
    const viewport = page.getViewport({ scale })
    const canvas   = document.createElement('canvas')
    canvas.width   = Math.floor(viewport.width)
    canvas.height  = Math.floor(viewport.height)
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/jpeg', 0.92)
    })
    blobs.push(blob)
  }
  return blobs
}

/**
 * Renders the first page of a PDF file into a JPEG Blob.
 *
 * @param {File|Blob} file   - PDF file to convert
 * @param {number}    scale  - Render scale (2 = retina quality)
 * @returns {Promise<Blob>}  - JPEG image of the first page
 */
export async function convertPdfToImage(file, scale = 2) {
  const pdfjs      = await loadPdfJs()
  const arrayBuffer = await file.arrayBuffer()
  const pdf        = await pdfjs.getDocument({ data: arrayBuffer }).promise
  const page       = await pdf.getPage(1)
  const viewport   = page.getViewport({ scale })

  const canvas    = document.createElement('canvas')
  canvas.width    = Math.floor(viewport.width)
  canvas.height   = Math.floor(viewport.height)
  const ctx = canvas.getContext('2d')

  await page.render({ canvasContext: ctx, viewport }).promise

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Conversion PDF échouée'))),
      'image/jpeg',
      0.92,
    )
  })
}

/** Returns true if the file is a PDF. */
export function isPdf(file) {
  return (
    file?.type === 'application/pdf' ||
    file?.name?.toLowerCase().endsWith('.pdf')
  )
}

/**
 * Attempts to extract native text from a PDF (up to maxPages pages).
 * Returns the text if the PDF is text-based, or null if it is scanned/image-only.
 */
export async function extractPdfNativeText(file, maxPages = 5) {
  try {
    const pdfjs       = await loadPdfJs()
    const arrayBuffer = await file.arrayBuffer()
    const pdf         = await pdfjs.getDocument({ data: arrayBuffer }).promise
    const total       = Math.min(pdf.numPages, maxPages)

    let fullText = ''
    for (let i = 1; i <= total; i++) {
      const page    = await pdf.getPage(i)
      const content = await page.getTextContent()
      const pageText = content.items.map((item) => item.str).join(' ')
      fullText += pageText + '\n'
    }

    const cleaned    = fullText.trim()
    const letterCount = (cleaned.match(/\p{L}/gu) || []).length
    // Fewer than 80 letters → treat as scanned (no usable native text)
    if (letterCount < 80) return null
    // Detect CID-encoded fonts: pdfjs returns "(cid:23)(cid:45)..." instead of real text.
    // If > 5% of non-whitespace chars are part of (cid:xx) sequences, treat as scanned.
    const cidMatches = (cleaned.match(/\(cid:\d+\)/g) || []).length
    const nonWsLen   = cleaned.replace(/\s/g, '').length
    if (nonWsLen > 0 && cidMatches / nonWsLen > 0.01) return null
    return cleaned
  } catch {
    return null
  }
}
