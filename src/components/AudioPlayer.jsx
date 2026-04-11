import { useState, useEffect, useRef } from 'react'
import { speak, stopSpeech, pauseSpeech, resumeSpeech } from '../services/tts'

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
  const [playing, setPlaying] = useState(false)
  const [paused, setPaused] = useState(false)
  const [speedIndex, setSpeedIndex] = useState(2) // default 1.0x
  const [copied, setCopied] = useState(false)
  const hasStartedRef = useRef(false)

  const isReady = !isProcessing && !error && translatedText

  // Auto-play when ready
  useEffect(() => {
    if (isReady && !hasStartedRef.current) {
      hasStartedRef.current = true
      handlePlay()
    }
  }, [isReady])

  // Cleanup on unmount
  useEffect(() => {
    return () => stopSpeech()
  }, [])

  const handlePlay = () => {
    if (!translatedText) return
    const rate = SPEEDS[speedIndex]
    speak(translatedText, targetLang.tts, {
      rate,
      onEnd: () => { setPlaying(false); setPaused(false) },
      onError: () => { setPlaying(false); setPaused(false) }
    })
    setPlaying(true)
    setPaused(false)
  }

  const handlePauseResume = () => {
    if (paused) {
      resumeSpeech()
      setPaused(false)
    } else {
      pauseSpeech()
      setPaused(true)
    }
  }

  const handleStop = () => {
    stopSpeech()
    setPlaying(false)
    setPaused(false)
  }

  const handleReplay = () => {
    handleStop()
    setTimeout(handlePlay, 100)
  }

  const handleSpeedChange = () => {
    const next = (speedIndex + 1) % SPEEDS.length
    setSpeedIndex(next)
    if (playing) {
      handleStop()
      setTimeout(() => {
        speak(translatedText, targetLang.tts, {
          rate: SPEEDS[next],
          onEnd: () => { setPlaying(false); setPaused(false) },
          onError: () => { setPlaying(false); setPaused(false) }
        })
        setPlaying(true)
        setPaused(false)
      }, 100)
    }
  }

  const handleCopy = () => {
    if (!translatedText) return
    navigator.clipboard.writeText(translatedText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const ocrDone = ocrProgress >= 100
  const translateDone = translateProgress >= 100

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 bg-gradient-to-b from-primary-50 to-white sticky top-0 z-10">
        <button
          onClick={() => { handleStop(); onBack() }}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label="Go back"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 className="font-bold text-gray-900 text-lg leading-tight">
            {isProcessing ? 'Processing...' : error ? 'Something went wrong' : 'Your Audio is Ready!'}
          </h2>
          <p className="text-gray-400 text-xs">Step 3 of 3 · {targetLang.flag} {targetLang.name}</p>
        </div>
        {imagePreview && (
          <img src={imagePreview} alt="document" className="ml-auto w-10 h-12 object-cover rounded-lg border border-gray-200" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-32">
        {/* Processing state */}
        {isProcessing && (
          <div className="space-y-4 mt-2">
            <ProgressItem
              label="Reading document"
              emoji="🔍"
              progress={ocrProgress}
              done={ocrDone}
            />
            <ProgressItem
              label={`Translating to ${targetLang.name}`}
              emoji="🌐"
              progress={ocrDone ? translateProgress : 0}
              done={translateDone}
              disabled={!ocrDone}
            />
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 rounded-2xl p-5">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-bold text-red-700 mb-1">Error</p>
                <p className="text-red-600 text-sm">{error}</p>
              </div>
            </div>
            <button
              onClick={onStartOver}
              className="mt-4 w-full bg-red-600 text-white rounded-xl py-3 font-bold text-sm hover:bg-red-700 transition-colors"
            >
              Try Again
            </button>
          </div>
        )}

        {/* Audio controls */}
        {isReady && (
          <div className="mt-2 space-y-4">
            {/* Big play area */}
            <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-3xl p-6 text-white flex flex-col items-center gap-4">
              <div className="text-4xl">{targetLang.flag}</div>
              <p className="text-sm text-blue-200 text-center">
                Audio in <strong className="text-white">{targetLang.name}</strong>
              </p>

              {/* Play / Pause / Stop */}
              <div className="flex items-center gap-4">
                <button
                  onClick={handleReplay}
                  className="w-11 h-11 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/30 active:bg-white/40 transition-colors"
                  aria-label="Replay"
                >
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                  </svg>
                </button>

                {/* Main play/pause */}
                <button
                  onClick={playing ? handlePauseResume : handlePlay}
                  className="w-20 h-20 rounded-full bg-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform relative"
                  aria-label={playing && !paused ? 'Pause' : 'Play'}
                >
                  {playing && !paused ? (
                    <svg className="w-9 h-9 text-primary-700" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  ) : (
                    <svg className="w-9 h-9 text-primary-700 ml-1" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  )}
                  {playing && !paused && (
                    <span className="absolute inset-0 rounded-full bg-white/30 pulse-ring" />
                  )}
                </button>

                <button
                  onClick={handleStop}
                  disabled={!playing}
                  className={`w-11 h-11 rounded-full flex items-center justify-center transition-colors ${
                    playing ? 'bg-white/20 hover:bg-white/30 active:bg-white/40' : 'bg-white/10 opacity-40 cursor-not-allowed'
                  }`}
                  aria-label="Stop"
                >
                  <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M6 6h12v12H6z"/>
                  </svg>
                </button>
              </div>

              {/* Speed control */}
              <button
                onClick={handleSpeedChange}
                className="px-4 py-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-sm font-bold"
              >
                {SPEEDS[speedIndex]}x speed
              </button>
            </div>

            {/* Translated text */}
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Translated text
                </p>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-primary-600 font-medium hover:text-primary-700 transition-colors"
                >
                  {copied ? (
                    <>
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Copied!
                    </>
                  ) : (
                    <>
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
              <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-line">{translatedText}</p>
            </div>
          </div>
        )}
      </div>

      {/* Start over */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-3 bg-white border-t border-gray-100 safe-bottom">
        <button
          onClick={() => { handleStop(); onStartOver() }}
          className="w-full flex items-center justify-center gap-2 border-2 border-primary-600 text-primary-700 rounded-2xl py-4 font-bold text-base hover:bg-primary-50 active:bg-primary-100 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Translate another document
        </button>
      </div>
    </div>
  )
}

function ProgressItem({ label, emoji, progress, done, disabled }) {
  return (
    <div className={`bg-gray-50 rounded-2xl p-4 border transition-colors ${disabled ? 'opacity-40 border-gray-100' : done ? 'border-green-200 bg-green-50' : 'border-primary-100'}`}>
      <div className="flex items-center gap-3 mb-2">
        {done ? (
          <span className="text-xl">✅</span>
        ) : disabled ? (
          <span className="text-xl">⏳</span>
        ) : (
          <span className={`text-xl ${!disabled && !done ? 'spin-slow inline-block' : ''}`}>{emoji}</span>
        )}
        <p className="text-sm font-medium text-gray-700 flex-1">{label}</p>
        <span className="text-xs font-bold text-gray-500">{progress}%</span>
      </div>
      <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-green-500' : 'bg-primary-500'}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  )
}
