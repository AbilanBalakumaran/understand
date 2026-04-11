import { useState, useCallback } from 'react'
import UploadStep from './components/UploadStep'
import LanguageSelect from './components/LanguageSelect'
import AudioPlayer from './components/AudioPlayer'
import { extractText } from './services/ocr'
import { translateText } from './services/translate'

const STEP = { UPLOAD: 0, LANGUAGE: 1, AUDIO: 2 }

export default function App() {
  const [step, setStep] = useState(STEP.UPLOAD)
  const [imageFile, setImageFile] = useState(null)
  const [imagePreview, setImagePreview] = useState(null)
  const [targetLang, setTargetLang] = useState(null)
  const [translatedText, setTranslatedText] = useState('')
  const [ocrProgress, setOcrProgress] = useState(0)
  const [translateProgress, setTranslateProgress] = useState(0)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState(null)

  const handleImageSelected = useCallback((file, preview) => {
    setImageFile(file)
    setImagePreview(preview)
  }, [])

  const handleUploadNext = () => {
    if (!imageFile) return
    setStep(STEP.LANGUAGE)
  }

  const handleLanguageConfirm = async ({ sourceLang, targetLang: tl }) => {
    setTargetLang(tl)
    setStep(STEP.AUDIO)
    setIsProcessing(true)
    setError(null)
    setOcrProgress(0)
    setTranslateProgress(0)
    setTranslatedText('')

    try {
      // Step 1: OCR
      const rawText = await extractText(imageFile, sourceLang.code, (p) => setOcrProgress(p))
      setOcrProgress(100)

      if (!rawText || rawText.trim().length < 3) {
        throw new Error("No text could be read from the image. Please try with a clearer photo.")
      }

      // Step 2: Translate
      const translated = await translateText(rawText, sourceLang.apiCode, tl.code, (p) => setTranslateProgress(p))
      setTranslateProgress(100)
      setTranslatedText(translated)
    } catch (err) {
      setError(err.message || 'An unexpected error occurred. Please try again.')
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
  }

  return (
    <div className="max-w-md mx-auto relative min-h-screen px-3 sm:px-0">
      {step === STEP.UPLOAD && (
        <UploadStep
          onImageSelected={(file, preview) => {
            handleImageSelected(file, preview)
            // Automatically advance to language selection after image is picked
            setTimeout(() => setStep(STEP.LANGUAGE), 300)
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
          ocrProgress={ocrProgress}
          translateProgress={translateProgress}
          isProcessing={isProcessing}
          error={error}
          onStartOver={handleStartOver}
          onBack={() => setStep(STEP.LANGUAGE)}
        />
      )}
    </div>
  )
}
