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

// ── App language persistence ─────────────────────────────────────────────────
const APP_LANG_KEY = 'understand_appLang'

function loadAppLang() {
  try { return localStorage.getItem(APP_LANG_KEY) || 'fr' } catch { return 'fr' }
}
function saveAppLang(lang) {
  try { localStorage.setItem(APP_LANG_KEY, lang) } catch {}
}

// ── Settings modal ────────────────────────────────────────────────────────────
function SettingsModal({ appLang, onChangeLang, onClose }) {
  const isFr = appLang === 'fr'

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />

      {/* Sheet */}
      <div
        className="relative w-full max-w-md bg-white rounded-t-[28px] px-5 pb-safe settings-overlay"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 32px)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mt-3 mb-5" />

        <h3 className="font-bold text-gray-900 text-lg mb-1">
          {isFr ? 'Paramètres' : 'Settings'}
        </h3>
        <p className="text-gray-400 text-xs mb-5">
          {isFr ? "Langue de l'application" : 'Application language'}
        </p>

        <div className="flex flex-col gap-2">
          {[
            { code: 'fr', label: 'Français', sub: 'Interface en français', flag: '🇫🇷' },
            { code: 'en', label: 'English',  sub: 'Interface in English',  flag: '🇬🇧' },
          ].map((opt) => (
            <button
              key={opt.code}
              onClick={() => { onChangeLang(opt.code); onClose() }}
              className={`flex items-center gap-3 w-full rounded-2xl px-4 py-3.5 border transition-all text-left ${
                appLang === opt.code
                  ? 'bg-primary-50 border-primary-300'
                  : 'bg-gray-50 border-gray-100 hover:bg-gray-100'
              }`}
            >
              <span className="text-2xl">{opt.flag}</span>
              <div className="flex-1">
                <p className={`font-semibold text-sm ${appLang === opt.code ? 'text-primary-700' : 'text-gray-800'}`}>
                  {opt.label}
                </p>
                <p className="text-xs text-gray-400">{opt.sub}</p>
              </div>
              {appLang === opt.code && (
                <svg className="w-5 h-5 text-primary-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function App() {
  // ── Splash ──────────────────────────────────────────────────────
  const [splashDone, setSplashDone]             = useState(false)

  // ── App language ─────────────────────────────────────────────────
  const [appLang, setAppLang]                   = useState(loadAppLang)
  const [showSettings, setShowSettings]         = useState(false)

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

  const handleChangeLang = (code) => {
    setAppLang(code)
    saveAppLang(code)
  }

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

    requestNotifPermission()

    try {
      const rawText = await extractText(imageFile, sourceLang.code, (p) => setOcrProgress(p))
      setOcrProgress(100)

      if (!rawText || rawText.trim().length < 3) {
        throw new Error("Aucun texte lisible dans l'image. Prenez une photo plus nette.")
      }

      const cleanedText = cleanOCRText(rawText, tl.code)

      if (!cleanedText || cleanedText.trim().length < 3) {
        throw new Error("Le texte extrait ne contient pas de contenu lisible. Essayez avec une photo du document seul.")
      }

      const translated = await translateText(cleanedText, sourceLang.apiCode, tl.code, (p) => setTranslateProgress(p))
      setTranslateProgress(100)
      setTranslatedText(translated)

      sendNotification(
        'Understand — Audio prêt ! 🎧',
        `Votre document a été traduit en ${appLang === 'fr' ? (tl.nameFr || tl.name) : tl.name}. Touchez pour écouter.`
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
      {!splashDone && <SplashScreen onDone={() => setSplashDone(true)} />}

      {/* Settings modal */}
      {showSettings && (
        <SettingsModal
          appLang={appLang}
          onChangeLang={handleChangeLang}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/*
        Barre de couleur qui remplit la zone status-bar iOS (safe-area-inset-top).
        En mode black-translucent le contenu passe sous la barre système — ce div
        la masque avec la couleur primaire. Sur Android son hauteur est 0.
      */}
      <div className="fixed top-0 left-0 right-0 bg-primary-600 z-[9997] safe-top-h" />

      <div className="max-w-md mx-auto relative min-h-screen" style={{ background: '#F4F6FF' }}>
        {step === STEP.UPLOAD && (
          <UploadStep
            appLang={appLang}
            onImageSelected={(file, preview) => {
              handleImageSelected(file, preview)
              setStep(STEP.LANGUAGE)
            }}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}

        {step === STEP.LANGUAGE && (
          <LanguageSelect
            appLang={appLang}
            imagePreview={imagePreview}
            onConfirm={handleLanguageConfirm}
            onBack={() => setStep(STEP.UPLOAD)}
            detectedLang={detectedSourceLang}
            isDetecting={isDetecting}
            onOpenSettings={() => setShowSettings(true)}
          />
        )}

        {step === STEP.AUDIO && targetLang && (
          <AudioPlayer
            appLang={appLang}
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
