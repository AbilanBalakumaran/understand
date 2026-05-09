import { useState, useCallback, useEffect, useRef } from 'react'
import UploadStep     from './components/UploadStep'
import LanguageSelect from './components/LanguageSelect'
import AudioPlayer    from './components/AudioPlayer'
import SplashScreen   from './components/SplashScreen'
import { extractText, detectImageLanguage } from './services/ocr'
import { translateText } from './services/translate'
import { requestNotifPermission, sendNotification } from './services/notifications'
import { SOURCE_LANGUAGES } from './data/languages'

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
    if (letters.length < line.length * 0.35) return false
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
  const [ocrProgress, setOcrProgress]           = useState(0)
  const [translateProgress, setTranslateProgress] = useState(0)
  const [isProcessing, setIsProcessing]         = useState(false)
  const [error, setError]                       = useState(null)

  // ── Language detection ──────────────────────────────────────────
  const [detectedSourceLang, setDetectedSourceLang] = useState(null)
  const [isDetecting, setIsDetecting]               = useState(false)
  const detectAbortRef                              = useRef(false)

  // Scroll to top on every step change
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [step])

  // Run detection when entering LanguageSelect
  useEffect(() => {
    if (step !== STEP.LANGUAGE || !imageFile) return

    detectAbortRef.current = false
    setIsDetecting(true)
    setDetectedSourceLang(null)

    detectImageLanguage(imageFile).then((code) => {
      if (detectAbortRef.current) return
      if (code) {
        const lang = SOURCE_LANGUAGES.find((l) => l.code === code) || null
        setDetectedSourceLang(lang)
      }
      setIsDetecting(false)
    })

    return () => { detectAbortRef.current = true }
  }, [step, imageFile])

  const handleImageSelected = useCallback((file, preview) => {
    setImageFile(file)
    setImagePreview(preview)
  }, [])

  const handleLanguageConfirm = async ({ sourceLang, targetLang: tl }) => {
    setTargetLang(tl)
    setStep(STEP.AUDIO)
    setIsProcessing(true)
    setError(null)
    setOcrProgress(0)
    setTranslateProgress(0)
    setTranslatedText('')

    // Ask for notification permission at the start of processing
    // (must be triggered by a user gesture — this callback is called from a button click)
    requestNotifPermission()

    try {
      // Step 1 — OCR
      const rawText = await extractText(imageFile, sourceLang.code, (p) => setOcrProgress(p))
      setOcrProgress(100)

      if (!rawText || rawText.trim().length < 3) {
        throw new Error("Aucun texte lisible dans l'image. Prenez une photo plus nette.")
      }

      const cleanedText = cleanOCRText(rawText, tl.code)

      if (!cleanedText || cleanedText.trim().length < 3) {
        throw new Error("Le texte extrait ne contient pas de contenu lisible. Essayez avec une photo du document seul.")
      }

      // Step 2 — Translate
      const translated = await translateText(cleanedText, sourceLang.apiCode, tl.code, (p) => setTranslateProgress(p))
      setTranslateProgress(100)
      setTranslatedText(translated)

      // Notify the user that their document is ready (even if the tab is in background)
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

  const handleStartOver = () => {
    setStep(STEP.UPLOAD)
    setImageFile(null)
    setImagePreview(null)
    setTargetLang(null)
    setTranslatedText('')
    setOcrProgress(0)
    setTranslateProgress(0)
    setIsProcessing(false)
    setError(null)
    setDetectedSourceLang(null)
    setIsDetecting(false)
  }

  return (
    <>
      {/* Splash screen — shown once on launch */}
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}

      <div className="max-w-md mx-auto relative min-h-screen">
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
            detectedLang={detectedSourceLang}
            isDetecting={isDetecting}
          />
        )}

        {step === STEP.AUDIO && targetLang && (
          <AudioPlayer
            imagePreview={imagePreview}
            targetLang={targetLang}
            translatedText={translatedText}
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
