import { useState, useCallback, useEffect, useRef } from 'react'
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

  // ── Run ID — each processing run captures its own ID at start.
  // Any navigation or new run increments the ID; stale runs self-abort when
  // they detect their captured ID no longer matches the current one.
  // Fixes double-tap: a second call increments runId so the first run aborts.
  const runIdRef = useRef(0)

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

  const handleLanguageConfirm = async ({ targetLang: tl, sourceLang: sl }) => {
    if (!imageFile) return  // guard: no image selected (shouldn't happen, but safe)
    const myRunId = ++runIdRef.current  // capture unique ID for this run
    const stale = () => runIdRef.current !== myRunId  // true if superseded

    setTargetLang(tl)
    setStep(STEP.AUDIO)
    setIsProcessing(true)
    setError(null)
    setOcrProgress(0)
    setTranslateProgress(0)
    setTranslatedText('')
    setDetectedLang(null)

    requestNotifPermission()

    const run = async () => {
      try {
        const originalPdf = imageFile?._originalPdf
        let rawText  = null
        let isNative = false

        if (originalPdf) {
          setOcrProgress(20)
          rawText = await extractPdfNativeText(originalPdf, 20)
          if (stale()) return
          if (rawText) {
            isNative = true
            setOcrProgress(100)
          } else {
            const pageBlobs = await convertPdfToImages(originalPdf, 10)
            if (stale()) return
            const parts = []
            for (let i = 0; i < pageBlobs.length; i++) {
              if (stale()) return
              const pageText = await extractTextAuto(pageBlobs[i], (p) =>
                setOcrProgress(Math.round((i / pageBlobs.length) * 100 + p / pageBlobs.length)),
                sl !== 'auto' ? sl : null
              )
              if (pageText?.trim()) parts.push(pageText.trim())
            }
            rawText = parts.join('\n\n')
          }
        }

        if (!rawText) {
          rawText = await extractTextAuto(imageFile, (p) => setOcrProgress(p), sl !== 'auto' ? sl : null)
          if (stale()) return
        }

        setOcrProgress(100)

        if (!rawText || rawText.trim().length < 3) {
          throw new Error("Aucun texte lisible dans l'image. Prenez une photo plus nette.")
        }

        const cleanedText = isNative
          ? cleanNativePdfText(rawText)
          : cleanOCRText(rawText)

        if (!cleanedText || cleanedText.trim().length < 3) {
          throw new Error("Le texte extrait ne contient pas de contenu lisible. Essayez avec une photo du document seul.")
        }

        const { text: translated, detectedLang: dl } = await translateText(cleanedText, sl || 'auto', tl.code, (p) => setTranslateProgress(p))
        if (stale()) return

        setTranslateProgress(100)
        const isSameLang = dl && dl.split('-')[0] === tl.code.split('-')[0]
        setTranslatedText(isSameLang ? cleanedText : translated)
        if (dl) setDetectedLang(dl)

        sendNotification(
          'Understand — Audio prêt ! 🎧',
          `Votre document a été traduit en ${tl.name}. Touchez pour écouter.`
        )
      } catch (err) {
        if (stale()) return
        // Give a clear offline message when the network is the cause
        const isNetworkError = err instanceof TypeError &&
          (err.message.includes('fetch') || err.message.includes('network') ||
           err.message.includes('Failed') || err.message.includes('NetworkError') ||
           err.message.includes('Load failed'))  // Safari offline message
        const isOffline = !navigator.onLine
        const msg = (isOffline || isNetworkError)
          ? 'Pas de connexion internet. Vérifiez votre réseau et réessayez.'
          : err.message || 'Une erreur inattendue est survenue. Veuillez réessayer.'
        setError(msg)
      } finally {
        if (!stale()) setIsProcessing(false)
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
    runIdRef.current++  // invalidate any in-flight run
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
            onBack={() => { runIdRef.current++; setStep(STEP.LANGUAGE) }}
          />
        )}
      </div>
    </>
  )
}
