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

/**
 * Unicode ranges per script — used to strip target-script noise from OCR text.
 */
const TARGET_SCRIPT_REGEX = {
  ta: /[஀-௿]/g,
  te: /[ఀ-౿]/g,
  kn: /[ಀ-೿]/g,
  ml: /[ഀ-ൿ]/g,
  si: /[඀-෿]/g,
  hi: /[ऀ-ॿ]/g,
  mr: /[ऀ-ॿ]/g,
  ne: /[ऀ-ॿ]/g,
  ar: /[؀-ۿݐ-ݿ]/g,
  ur: /[؀-ۿݐ-ݿ]/g,
  fa: /[؀-ۿݐ-ݿ]/g,
  'zh-CN': /[一-鿿㐀-䶿]/g,
  'zh-TW': /[一-鿿㐀-䶿]/g,
  ja: /[぀-ヿ一-鿿]/g,
  ko: /[가-힯]/g,
  ru: /[Ѐ-ӿ]/g,
  uk: /[Ѐ-ӿ]/g,
  ka: /[Ⴀ-ჿ]/g,
  hy: /[԰-֏]/g,
  am: /[ሀ-፿]/g,
}

// A token is a "real word" if it has 2+ letters and at least one vowel.
// Short all-uppercase tokens (≤ 3 chars) are treated as OCR noise.
function isRealWord(token) {
  const letters = token.replace(/[^a-zA-ZÀ-ÿĀ-ɏ]/g, '')
  if (letters.length < 2) return false
  if (letters.length <= 3 && letters === letters.toUpperCase()) return false
  return /[aeiouyàáâãäåèéêëìíîïòóôõöùúûüæœАЕИОУЫЭЮЯ]/i.test(letters)
}

function cleanOCRText(text, targetLangCode) {
  const scriptRegex = TARGET_SCRIPT_REGEX[targetLangCode]
  let processed = scriptRegex
    ? text.replace(new RegExp(scriptRegex.source, 'g'), '')
    : text

  const lines   = processed.split('\n').map((l) => l.trim()).filter(Boolean)
  const cleaned = lines.filter((line) => {
    const letters = (line.match(/\p{L}/gu) || [])
    if (letters.length < 4) return false
    if (/^[""''"'<>\[\]{}/\\|=+*&#@~`]+/.test(line)) return false
    if (/^\d{1,2}:\d{2}/.test(line)) return false
    if (letters.length < line.length * 0.3) return false

    // Filter lines that are mostly OCR noise:
    // require at least 35% of space-separated tokens to be "real" words
    const tokens = line.split(/\s+/).filter(Boolean)
    if (tokens.length >= 3) {
      const realCount = tokens.filter(isRealWord).length
      if (realCount / tokens.length < 0.35) return false
    }

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
        let rawText = null

        if (originalPdf) {
          // Try native PDF text extraction first (instant, 100% accurate)
          rawText = await extractPdfNativeText(originalPdf, 20)

          if (!rawText) {
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

        const cleanedText = cleanOCRText(rawText, tl.code)

        if (!cleanedText || cleanedText.trim().length < 3) {
          throw new Error("Le texte extrait ne contient pas de contenu lisible. Essayez avec une photo du document seul.")
        }

        // Step 2 — Translate (auto source: API detects language per chunk)
        const { text: translated, detectedLang: dl } = await translateText(cleanedText, 'auto', tl.code, (p) => setTranslateProgress(p))
        setTranslateProgress(100)
        setTranslatedText(translated)
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
