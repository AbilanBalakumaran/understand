import { useState, useCallback, useEffect } from 'react'
import UploadStep     from './components/UploadStep'
import LanguageSelect from './components/LanguageSelect'
import AudioPlayer    from './components/AudioPlayer'
import SplashScreen   from './components/SplashScreen'
import { extractTextAuto } from './services/ocr'
import { extractPdfNativeText, convertPdfToImages } from './services/pdf'
import { translateText } from './services/translate'
import { requestNotifPermission, sendNotification } from './services/notifications'

const STEP = { UPLOAD: 0, LANGUAGE: 1, AUDIO: 2 }

// Light cleaning for native PDF text — only normalise whitespace and strip
// invisible control characters. Never filters valid content.
function cleanNativePdfText(text) {
  return text
    .replace(/[\x00-\x08\x0B-\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// OCR noise filter — removes only scanner garbage, nothing else.
// We no longer strip target-script characters: the OSD-based OCR pipeline
// already uses the correct Tesseract model per script, so cross-script
// hallucinations no longer occur. Stripping by script caused identity-case
// failures (e.g. Arabic doc → Arabic target → all Arabic text erased).
function cleanOCRText(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const cleaned = lines.filter(line => {
    const letters = (line.match(/\p{L}/gu) || [])
    if (letters.length === 0) return false                        // pure symbols/numbers
    if (/^[|_=+*#~`]{3,}/.test(line)) return false               // scanner border artefacts
    if (/^\d{1,2}:\d{2}$/.test(line)) return false               // video timestamps
    if (letters.length < line.replace(/\s/g, '').length * 0.10) return false // < 10% letters
    return true
  })
  return cleaned.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

export default function App() {
  // ── Splash ──────────────────────────────────────────────────────
  const [splashDone, setSplashDone]             = useState(false)

  // ── Navigation ──────────────────────────────────────────────────
  const [step, setStep]                         = useState(STEP.UPLOAD)

  // ── Image ───────────────────────────────────────────────────────
  const [imageFile, setImageFile]               = useState(null)
  const [imagePreview, setImagePreview]         = useState(null)

  // ── Processing ──────────────────────────────────────────────────
  const [targetLang, setTargetLang]             = useState(null)
  const [translatedText, setTranslatedText]     = useState('')
  const [detectedLang, setDetectedLang]         = useState(null)
  const [ocrProgress, setOcrProgress]           = useState(0)
  const [translateProgress, setTranslateProgress] = useState(0)
  const [isProcessing, setIsProcessing]         = useState(false)
  const [error, setError]                       = useState(null)

  // Scroll to top on every step change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [step])

  const handleImageSelected = useCallback((file, preview) => {
    setImageFile(file)
    setImagePreview(preview)
  }, [])

  const handleLanguageConfirm = async ({ targetLang: tl }) => {
    setTargetLang(tl)
    setStep(STEP.AUDIO)
    setIsProcessing(true)
    setError(null)
    setOcrProgress(0)
    setTranslateProgress(0)
    setTranslatedText('')
    setDetectedLang(null)

    // Ask for notification permission at the start of processing
    // (must be triggered by a user gesture — this callback is called from a button click)
    requestNotifPermission()

    const run = async () => {
      try {
        // Step 1 — Text extraction
        // Priority: native PDF text → multi-page scanned OCR → single image OCR
        const originalPdf = imageFile?._originalPdf
        let rawText  = null
        let isNative = false

        if (originalPdf) {
          // Simulate progress while pdfjs loads (native extraction is instant)
          setOcrProgress(20)
          rawText = await extractPdfNativeText(originalPdf, 20)
          if (rawText) {
            isNative = true
            setOcrProgress(100)
          } else {
            // Scanned PDF: OCR each page
            const pageBlobs = await convertPdfToImages(originalPdf, 10)
            const parts = []
            for (let i = 0; i < pageBlobs.length; i++) {
              const pageText = await extractTextAuto(pageBlobs[i], (p) =>
                setOcrProgress(Math.round((i / pageBlobs.length) * 100 + p / pageBlobs.length))
              )
              if (pageText?.trim()) parts.push(pageText.trim())
            }
            rawText = parts.join('\n\n')
          }
        }

        if (!rawText) {
          // Single image (or fallback)
          rawText = await extractTextAuto(imageFile, (p) => setOcrProgress(p))
        }

        setOcrProgress(100)

        if (!rawText || rawText.trim().length < 3) {
          throw new Error("Aucun texte lisible dans l'image. Prenez une photo plus nette.")
        }

        // Use light cleaning for native PDF (no OCR noise), full filter for images
        const cleanedText = isNative
          ? cleanNativePdfText(rawText)
          : cleanOCRText(rawText)

        if (!cleanedText || cleanedText.trim().length < 3) {
          throw new Error("Le texte extrait ne contient pas de contenu lisible. Essayez avec une photo du document seul.")
        }

        // Step 2 — Translate (auto source: API detects language per chunk)
        const { text: translated, detectedLang: dl } = await translateText(cleanedText, 'auto', tl.code, (p) => setTranslateProgress(p))
        setTranslateProgress(100)

        // If Google detected the source == target language, the doc is already
        // in the right language — show the original text as-is.
        const isSameLang = dl && dl.split('-')[0] === tl.code.split('-')[0]
        setTranslatedText(isSameLang ? cleanedText : translated)
        if (dl) setDetectedLang(dl)

        sendNotification(
          'Understand — Audio prêt ! 🎧',
          `Votre document a été traduit en ${tl.name}. Touchez pour écouter.`
        )
      } catch (err) {
        setError(err.message || 'Une erreur inattendue est survenue. Veuillez réessayer.')
      } finally {
        setIsProcessing(false)
      }
    }

    // Keep the task alive even when the tab goes to background
    if ('locks' in navigator) {
      navigator.locks.request('understand-processing', { mode: 'exclusive' }, run)
    } else {
      run()
    }
  }

  const handleStartOver = () => {
    setStep(STEP.UPLOAD)
    setImageFile(null)
    setImagePreview(null)
    setTargetLang(null)
    setTranslatedText('')
    setDetectedLang(null)
    setOcrProgress(0)
    setTranslateProgress(0)
    setIsProcessing(false)
    setError(null)
  }

  return (
    <>
      {/* Splash screen — shown once on launch */}
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}

      <div className="max-w-md mx-auto relative">
        {step === STEP.UPLOAD && (
          <UploadStep
            onImageSelected={(file, preview) => {
              handleImageSelected(file, preview)
              setStep(STEP.LANGUAGE)
            }}
          />
        )}

        {step === STEP.LANGUAGE && (
          <LanguageSelect
            imagePreview={imagePreview}
            onConfirm={handleLanguageConfirm}
            onBack={() => setStep(STEP.UPLOAD)}
          />
        )}

        {step === STEP.AUDIO && targetLang && (
          <AudioPlayer
            imagePreview={imagePreview}
            targetLang={targetLang}
            translatedText={translatedText}
            detectedLang={detectedLang}
            ocrProgress={ocrProgress}
            translateProgress={translateProgress}
            isProcessing={isProcessing}
            error={error}
            onStartOver={handleStartOver}
            onBack={() => setStep(STEP.LANGUAGE)}
          />
        )}
      </div>
    </>
  )
}
