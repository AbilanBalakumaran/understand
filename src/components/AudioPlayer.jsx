import { useState, useEffect, useMemo } from 'react'
import { speak, stopSpeech, pauseSpeech, resumeSpeech, splitIntoChunks } from '../services/tts'

const SPEEDS = [0.6, 0.8, 1.0, 1.2, 1.5]

export default function AudioPlayer({
  imagePreview,
  targetLang,
  translatedText,
  ocrProgress,
  translateProgress,
  isProcessing,
  error,
  onStartOver,
  onBack
}) {
  const [playing, setPlaying]           = useState(false)
  const [paused, setPaused]             = useState(false)
  const [speedIndex, setSpeedIndex]     = useState(2)
  const [copied, setCopied]             = useState(false)
  const [ttsError, setTtsError]         = useState(null)
  const [currentChunk, setCurrentChunk] = useState(-1)

  const isReady   = !isProcessing && !error && translatedText
  const ocrDone   = ocrProgress >= 100
  const transDone = translateProgress >= 100
  const verifying = isProcessing && ocrDone && transDone

  const chunks = useMemo(
    () => (translatedText ? splitIntoChunks(translatedText) : []),
    [translatedText]
  )

  // Cleanup on unmount
  useEffect(() => () => stopSpeech(), [])

  // Reset highlight when stopped
  useEffect(() => {
    if (!playing) setCurrentChunk(-1)
  }, [playing])

  const handlePlay = () => {
    if (!translatedText) return
    setTtsError(null)
    setCurrentChunk(0)
    speak(translatedText, targetLang.tts, {
      rate:         SPEEDS[speedIndex],
      onEnd:        () => { setPlaying(false); setPaused(false) },
      onError:      (err) => { setPlaying(false); setPaused(false); setTtsError(err.message) },
      onChunkStart: (idx) => setCurrentChunk(idx),
    })
    setPlaying(true)
    setPaused(false)
  }

  const handlePauseResume = () => {
    if (paused) { resumeSpeech(); setPaused(false) }
    else        { pauseSpeech();  setPaused(true)  }
  }

  const handleStop = () => { stopSpeech(); setPlaying(false); setPaused(false) }

  const handleSpeedChange = () => {
    const next = (speedIndex + 1) % SPEEDS.length
    setSpeedIndex(next)
    if (playing) {
      speak(translatedText, targetLang.tts, {
        rate:         SPEEDS[next],
        onEnd:        () => { setPlaying(false); setPaused(false) },
        onError:      (err) => { setPlaying(false); setPaused(false); setTtsError(err.message) },
        onChunkStart: (idx) => setCurrentChunk(idx),
      })
      setPlaying(true)
      setPaused(false)
    }
  }

  const handleCopy = () => {
    if (!translatedText) return
    navigator.clipboard.writeText(translatedText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 bg-gradient-to-b from-primary-50 to-white sticky top-0 z-10">
        <button
          onClick={() => { handleStop(); onBack() }}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label="Retour"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 className="font-bold text-gray-900 text-lg leading-tight">
            {isProcessing
              ? (verifying ? 'Vérification…' : 'Traitement…')
              : error ? 'Une erreur est survenue'
              : 'Audio prêt !'}
          </h2>
          <p className="text-gray-400 text-xs">Étape 3 / 3 · {targetLang.flag} {targetLang.name}</p>
        </div>
        {imagePreview && (
          <img src={imagePreview} alt="document" className="ml-auto w-10 h-12 object-cover rounded-xl border border-gray-200" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-32">

        {/* ── Progress bars (always visible at top) ── */}
        {isProcessing && (
          <div className="space-y-3 mt-2">
            <ProgressItem
              label="Lecture du document"
              icon={<ScanIcon />}
              progress={ocrProgress}
              done={ocrDone}
            />
            <ProgressItem
              label={`Traduction en ${targetLang.name}`}
              icon={<TranslateIcon />}
              progress={ocrDone ? translateProgress : 0}
              done={transDone}
              disabled={!ocrDone}
            />

            {/* Verification spinner */}
            {verifying && (
              <div className="bg-primary-50 border border-primary-100 rounded-2xl p-4 flex items-center gap-3">
                <svg className="w-5 h-5 text-primary-600 spin-slow shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                    strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
                </svg>
                <div>
                  <p className="text-sm font-semibold text-primary-700">Vérification de la traduction…</p>
                  <p className="text-xs text-primary-500">On s'assure que tout est bien en {targetLang.name}</p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Error ── */}
        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-full bg-red-100 flex items-center justify-center shrink-0 mt-0.5">
                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
              </div>
              <div>
                <p className="font-bold text-red-700 mb-1">Erreur</p>
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            </div>
            <button
              onClick={onStartOver}
              className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white rounded-xl py-3 font-bold text-sm transition-colors"
            >
              Réessayer
            </button>
          </div>
        )}

        {/* ── Audio player ── */}
        {isReady && (
          <div className="mt-2 space-y-4">

            {/* Player card */}
            <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-3xl p-6 text-white flex flex-col items-center gap-5 shadow-blue">
              <div className="text-4xl">{targetLang.flag}</div>

              {!playing && (
                <p className="text-sm text-white/70 text-center">
                  Appuyer pour écouter en <strong className="text-white">{targetLang.name}</strong>
                </p>
              )}

              {/* Controls */}
              <div className="flex items-center gap-5">
                {/* Replay */}
                <button
                  onClick={handlePlay}
                  className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition-colors"
                  aria-label="Rejouer depuis le début"
                >
                  <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                  </svg>
                </button>

                {/* Play / Pause */}
                <button
                  onClick={playing ? handlePauseResume : handlePlay}
                  className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform relative"
                  aria-label={playing && !paused ? 'Pause' : 'Lecture'}
                >
                  {playing && !paused ? (
                    <svg className="w-9 h-9 fill-primary-700" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg className="w-9 h-9 fill-primary-700 ml-1" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                  {playing && !paused && (
                    <span className="absolute inset-0 rounded-full bg-white/30 pulse-ring" />
                  )}
                </button>

                {/* Stop */}
                <button
                  onClick={handleStop}
                  disabled={!playing}
                  className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                    playing
                      ? 'bg-white/20 hover:bg-white/30 active:bg-white/40'
                      : 'bg-white/10 opacity-40 cursor-not-allowed'
                  }`}
                  aria-label="Arrêter"
                >
                  <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                    <path d="M6 6h12v12H6z"/>
                  </svg>
                </button>
              </div>

              {/* Speed */}
              <button
                onClick={handleSpeedChange}
                className="px-4 py-1.5 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 transition-colors text-sm font-bold"
              >
                {SPEEDS[speedIndex]}×
              </button>
            </div>

            {/* TTS error */}
            {ttsError && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-4 py-3.5 flex items-start gap-3">
                <svg className="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-red-600 text-sm leading-relaxed">{ttsError}</p>
              </div>
            )}

            {/* ── Translated text with live highlighting ── */}
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                  Texte traduit
                </p>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-primary-600 font-semibold hover:text-primary-700 transition-colors"
                >
                  {copied ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Copié !
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copier
                    </>
                  )}
                </button>
              </div>

              <p className="text-gray-700 text-sm leading-relaxed">
                {chunks.map((chunk, idx) => (
                  <span
                    key={idx}
                    className={
                      playing && currentChunk === idx
                        ? 'bg-primary-100 text-primary-800 rounded px-0.5 transition-colors duration-200'
                        : 'transition-colors duration-200'
                    }
                  >
                    {chunk}{' '}
                  </span>
                ))}
              </p>

              {!playing && translatedText && currentChunk >= 0 && (
                <p className="mt-3 text-center text-xs text-green-600 font-semibold flex items-center justify-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                  Lecture terminée
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Fixed bottom ── */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-3 bg-white border-t border-gray-100 safe-bottom shadow-card-lg">
        <button
          onClick={() => { handleStop(); onStartOver() }}
          className="w-full flex items-center justify-center gap-2 border-2 border-primary-600 text-primary-700 rounded-2xl py-4 font-bold text-base hover:bg-primary-50 active:bg-primary-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Traduire un autre document
        </button>
      </div>
    </div>
  )
}

/* ── Icon helpers ─────────────────────────────────────── */
function ScanIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  )
}

function TranslateIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
    </svg>
  )
}

/* ── Progress bar item ────────────────────────────────── */
function ProgressItem({ label, icon, progress, done, disabled }) {
  return (
    <div className={`rounded-2xl p-4 border transition-colors ${
      disabled
        ? 'opacity-40 bg-gray-50 border-gray-100'
        : done
          ? 'bg-green-50 border-green-200'
          : 'bg-white border-primary-100 shadow-card'
    }`}>
      <div className="flex items-center gap-3 mb-2.5">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          done ? 'bg-green-100 text-green-600' : disabled ? 'bg-gray-100 text-gray-400' : 'bg-primary-100 text-primary-600'
        } ${!disabled && !done ? 'spin-slow' : ''}`}>
          {done
            ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            : icon}
        </div>
        <p className="text-sm font-semibold text-gray-700 flex-1">{label}</p>
        <span className={`text-xs font-bold ${done ? 'text-green-600' : 'text-primary-600'}`}>
          {progress}%
        </span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-green-500' : 'bg-primary-500'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
