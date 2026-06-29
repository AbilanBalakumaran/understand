import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  speak, stopSpeech, pauseSpeech, resumeSpeech,
  splitIntoChunks, generateAudio, unlockAudioContext,
} from '../services/tts'
import { TARGET_LANGUAGES } from '../data/languages'

const SPEEDS = [0.6, 0.8, 1.0, 1.2, 1.5]

// Build from TARGET_LANGUAGES — single source of truth, always in sync
const LANG_DISPLAY = Object.fromEntries(
  TARGET_LANGUAGES.flatMap(l => {
    const base = l.code.split('-')[0]
    return [[base, [l.flag, l.nameFr]], [l.code, [l.flag, l.nameFr]]]
  })
)

function formatTime(secs) {
  if (!isFinite(secs) || isNaN(secs) || secs < 0) return '0:00'
  const m = Math.floor(secs / 60)
  const s = Math.floor(secs % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function AudioPlayer({
  imagePreview,
  targetLang,
  translatedText,
  detectedLang,
  ocrProgress,
  translateProgress,
  isProcessing,
  error,
  onStartOver,
  onBack,
}) {
  const isReady   = !isProcessing && !error && translatedText
  const ocrDone   = ocrProgress >= 100
  const transDone = translateProgress >= 100

  // 'idle' | 'loading' | 'ready' | 'streaming'
  const [audioPhase,    setAudioPhase]    = useState('idle')
  const [loadProgress,  setLoadProgress]  = useState(0)
  const [ttsError,      setTtsError]      = useState(null)
  const [speedIndex,    setSpeedIndex]    = useState(2)
  const [copied,        setCopied]        = useState(false)
  const [imgModalOpen,  setImgModalOpen]  = useState(false)
  const [imgZoom,       setImgZoom]       = useState(1)

  // Ready mode (blob + seek bar)
  const [audioDuration,    setAudioDuration]    = useState(0)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [isPlayingReady,   setIsPlayingReady]   = useState(false)

  // Streaming mode
  const [streamPlaying, setStreamPlaying] = useState(false)
  const [streamPaused,  setStreamPaused]  = useState(false)
  const [streamChunk,   setStreamChunk]   = useState(-1)

  const audioRef    = useRef(null)
  const audioUrlRef = useRef(null)
  const abortRef    = useRef(null)

  // Text chunks (for highlighting)
  const chunks = useMemo(
    () => (translatedText ? splitIntoChunks(translatedText) : []),
    [translatedText]
  )

  const { chunkOffsets, totalChars } = useMemo(() => {
    let offset = 0
    const offsets = chunks.map(c => { const s = offset; offset += c.length + 1; return s })
    return { chunkOffsets: offsets, totalChars: offset }
  }, [chunks])

  const readyChunkIdx = useMemo(() => {
    if (audioPhase !== 'ready' || audioDuration === 0) return -1
    const charPos = (audioCurrentTime / audioDuration) * totalChars
    let idx = 0
    for (let i = 0; i < chunkOffsets.length; i++) {
      if (chunkOffsets[i] <= charPos) idx = i
      else break
    }
    return idx
  }, [audioPhase, audioCurrentTime, audioDuration, chunkOffsets, totalChars])

  const activeChunk = audioPhase === 'ready' ? readyChunkIdx : streamChunk

  // Cleanup on unmount
  useEffect(() => () => {
    stopSpeech()
    abortRef.current?.abort()
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    if (audioRef.current) audioRef.current.pause()
  }, [])

  // Audio element events — attached once
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onTimeUpdate     = () => setAudioCurrentTime(audio.currentTime)
    const onDurationChange = () => setAudioDuration(isFinite(audio.duration) ? audio.duration : 0)
    const onEnded          = () => setIsPlayingReady(false)
    const onPlay           = () => setIsPlayingReady(true)
    const onPause          = () => setIsPlayingReady(false)
    const onError          = () => { setTtsError('Erreur de lecture audio. Réessayez.'); setIsPlayingReady(false) }
    audio.addEventListener('timeupdate',     onTimeUpdate)
    audio.addEventListener('durationchange', onDurationChange)
    audio.addEventListener('ended',          onEnded)
    audio.addEventListener('play',           onPlay)
    audio.addEventListener('pause',          onPause)
    audio.addEventListener('error',          onError)
    return () => {
      audio.removeEventListener('timeupdate',     onTimeUpdate)
      audio.removeEventListener('durationchange', onDurationChange)
      audio.removeEventListener('ended',          onEnded)
      audio.removeEventListener('play',           onPlay)
      audio.removeEventListener('pause',          onPause)
      audio.removeEventListener('error',          onError)
    }
  }, [])

  // Streaming fallback
  const startStreaming = useCallback(() => {
    speak(translatedText, targetLang.tts, {
      rate: SPEEDS[speedIndex],
      onEnd:        () => { setStreamPlaying(false); setStreamPaused(false); setStreamChunk(-1) },
      onError:      err => { setStreamPlaying(false); setStreamPaused(false); setTtsError(err.message) },
      onChunkStart: idx => setStreamChunk(idx),
    })
    setStreamPlaying(true)
    setStreamPaused(false)
    setStreamChunk(0)
  }, [translatedText, targetLang, speedIndex])

  // ── Main play button ──────────────────────────────────────────────────────
  // Step 1 (synchronous): unlock iOS audio context.
  // Step 2 (async): try Lingva blob for seek bar. Fallback to streaming.
  const handlePlayClick = useCallback(async () => {
    if (!translatedText || !isReady) return
    setTtsError(null)

    // Toggle play/pause if already in ready mode
    if (audioPhase === 'ready' && audioRef.current) {
      if (isPlayingReady) { audioRef.current.pause() }
      else { try { await audioRef.current.play() } catch { setTtsError('Lecture bloquée. Réessayez.') } }
      return
    }

    // ── SYNCHRONOUS: unlock iOS audio before any await ──
    unlockAudioContext()

    // Start loading
    const abort = new AbortController()
    abortRef.current = abort
    setAudioPhase('loading')
    setLoadProgress(0)

    const result = await generateAudio(translatedText, targetLang.tts, {
      onProgress: pct => setLoadProgress(pct),
      signal: abort.signal,
    })

    if (abort.signal.aborted) return

    if (!result) {
      // Lingva unavailable → stream via Google TTS
      setAudioPhase('streaming')
      startStreaming()
      return
    }

    // Build blob URL and play via <audio> element (seek bar enabled)
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    const url = URL.createObjectURL(result.blob)
    audioUrlRef.current = url
    setAudioPhase('ready')
    setAudioCurrentTime(0)

    const audio = audioRef.current
    if (audio) {
      audio.src = url
      audio.playbackRate = SPEEDS[speedIndex]
      audio.load()
      try {
        await audio.play()
        setIsPlayingReady(true)
      } catch {
        setTtsError('Lecture bloquée par le navigateur. Appuyez à nouveau sur Play.')
      }
    }
  }, [translatedText, isReady, audioPhase, isPlayingReady, targetLang, speedIndex, startStreaming])

  const handleCancelLoad = () => {
    abortRef.current?.abort()
    setAudioPhase('idle')
    setLoadProgress(0)
  }

  const handlePauseResume = () => {
    if (audioPhase === 'ready' && audioRef.current) {
      if (isPlayingReady) audioRef.current.pause()
      else audioRef.current.play().catch(() => {})
    } else if (audioPhase === 'streaming') {
      if (streamPaused) { resumeSpeech(); setStreamPaused(false) }
      else              { pauseSpeech();  setStreamPaused(true) }
    }
  }

  const handleStop = useCallback(() => {
    stopSpeech()
    abortRef.current?.abort()
    setStreamPlaying(false)
    setStreamPaused(false)
    setStreamChunk(-1)
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0 }
    setIsPlayingReady(false)
    setAudioCurrentTime(0)
  }, [])

  const handleSeek = e => {
    const t = parseFloat(e.target.value)
    if (audioRef.current) audioRef.current.currentTime = t
    setAudioCurrentTime(t)
  }

  const handleSkip = delta => {
    if (!audioRef.current) return
    const next = Math.max(0, Math.min(audioDuration, audioCurrentTime + delta))
    audioRef.current.currentTime = next
  }

  const handleSpeedChange = () => {
    const next = (speedIndex + 1) % SPEEDS.length
    setSpeedIndex(next)
    if (audioRef.current) audioRef.current.playbackRate = SPEEDS[next]
    if (audioPhase === 'streaming') {
      speak(translatedText, targetLang.tts, {
        rate: SPEEDS[next],
        onEnd:        () => { setStreamPlaying(false); setStreamPaused(false); setStreamChunk(-1) },
        onError:      err => { setStreamPlaying(false); setStreamPaused(false); setTtsError(err.message) },
        onChunkStart: idx => setStreamChunk(idx),
      })
      setStreamPlaying(true)
      setStreamPaused(false)
    }
  }

  const handleDownload = () => {
    if (!audioUrlRef.current) return
    const a = document.createElement('a')
    a.href = audioUrlRef.current
    a.download = `understand-${targetLang.tts.split('-')[0]}.mp3`
    a.click()
  }

  const handleCopy = () => {
    if (!translatedText) return
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(translatedText)
        .then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000) })
        .catch(() => legacyCopy())
    } else {
      legacyCopy()
    }
  }

  const legacyCopy = () => {
    try {
      const ta = document.createElement('textarea')
      ta.value = translatedText
      ta.style.position = 'fixed'
      ta.style.opacity  = '0'
      document.body.appendChild(ta)
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch (_) {}
  }

  const handleBack       = () => { handleStop(); onBack() }
  const handleStartOver  = () => { handleStop(); onStartOver() }

  const streamActive       = audioPhase === 'streaming'
  const isActuallyPlaying  = (audioPhase === 'ready' && isPlayingReady) ||
                              (streamActive && streamPlaying && !streamPaused)

  const dl = detectedLang?.split('-')[0]

  return (
    <>
    <div className="flex flex-col min-h-screen bg-white">
      <audio ref={audioRef} preload="auto" />

      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 sticky top-0 z-20"
        style={{
          background: 'var(--color-brand)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
          paddingBottom: '10px',
        }}
      >
        <button onClick={handleBack}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-white/15 hover:bg-white/25 active:bg-white/35 transition-colors shrink-0"
          aria-label="Retour">
          <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <h2 className="font-bold text-white text-lg leading-tight">
            {isProcessing ? 'Traitement…' : error ? 'Erreur' : 'Audio prêt !'}
          </h2>
          <p className="text-white/60 text-xs">Étape 3 / 3 · {targetLang.flag} {targetLang.name}</p>
        </div>
        {imagePreview && (
          <button onClick={() => { setImgZoom(1); setImgModalOpen(true) }}
            className="rounded-xl border-2 border-white/30 overflow-hidden hover:opacity-80 active:opacity-60 transition-opacity"
            aria-label="Agrandir le document">
            <img src={imagePreview} alt="document" className="w-10 h-12 object-cover block" />
          </button>
        )}
      </div>

      <div className="px-4 pb-32 pt-2">

        {/* ── Progress ── */}
        {isProcessing && (
          <div className="space-y-3 mt-2">
            <ProgressItem label="Lecture du document"                icon={<ScanIcon />}      progress={ocrProgress}             done={ocrDone} />
            <ProgressItem label={`Traduction en ${targetLang.name}`} icon={<TranslateIcon />} progress={ocrDone ? translateProgress : 0} done={transDone} disabled={!ocrDone} />
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
              <div><p className="font-bold text-red-700 mb-1">Erreur</p><p className="text-red-600 text-sm">{error}</p></div>
            </div>
            <button onClick={handleStartOver} className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white rounded-xl py-3 font-bold text-sm">Réessayer</button>
          </div>
        )}

        {/* ── Player ── */}
        {isReady && (
          <div className="mt-2 space-y-4">

            <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-3xl p-6 text-white shadow-blue">

              {/* Lang badge + speed + download (top row) */}
              <div className="flex items-center justify-between mb-4 gap-2">
                <div className="flex items-center gap-1.5 bg-white/15 rounded-xl px-2.5 py-1 min-w-0 flex-1">
                  {dl && LANG_DISPLAY[dl] ? (
                    <>
                      <span>{LANG_DISPLAY[dl][0]}</span>
                      <span className="text-white/80 text-xs truncate">{LANG_DISPLAY[dl][1]}</span>
                      <svg className="w-3 h-3 text-white/60 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7"/>
                      </svg>
                    </>
                  ) : null}
                  <span>{targetLang.flag}</span>
                  <span className="text-xs text-white/80 truncate">{targetLang.name}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {audioPhase === 'ready' && (
                    <button onClick={handleDownload}
                      className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition-colors"
                      aria-label="Télécharger l'audio MP3">
                      <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                      </svg>
                    </button>
                  )}
                  <button onClick={handleSpeedChange}
                    className="px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 text-xs font-bold">
                    {SPEEDS[speedIndex]}×
                  </button>
                </div>
              </div>

              {/* ── IDLE ── */}
              {audioPhase === 'idle' && (
                <button onClick={handlePlayClick}
                  className="w-full flex items-center justify-center gap-3 bg-white text-primary-700 rounded-2xl py-4 font-bold text-base shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-transform">
                  <svg className="w-6 h-6 fill-primary-700 ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  Écouter
                </button>
              )}

              {/* ── LOADING ── */}
              {audioPhase === 'loading' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-white/80">Génération de l'audio…</span>
                    <span className="font-bold">{loadProgress}%</span>
                  </div>
                  <div className="h-2 bg-white/20 rounded-full overflow-hidden">
                    <div className="h-full bg-white rounded-full transition-all duration-300" style={{ width: `${loadProgress}%` }} />
                  </div>
                  <button onClick={handleCancelLoad}
                    className="w-full text-center text-white/60 text-sm py-1 hover:text-white transition-colors">
                    Annuler
                  </button>
                </div>
              )}

              {/* ── READY (blob + seek bar) ── */}
              {audioPhase === 'ready' && (
                <div className="space-y-4">
                  <div className="space-y-1">
                    <input
                      type="range" min={0} max={audioDuration || 1} value={audioCurrentTime} step={0.5}
                      onChange={handleSeek}
                      className="w-full h-1 rounded-full cursor-pointer appearance-none"
                      style={{ accentColor: 'white' }}
                    />
                    <div className="flex justify-between text-xs text-white/60">
                      <span>{formatTime(audioCurrentTime)}</span>
                      <span>{formatTime(audioDuration)}</span>
                    </div>
                  </div>
                  {/* Controls — centré */}
                  <div className="flex items-center justify-center gap-4">
                    <button onClick={() => handleSkip(-10)}
                      className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition-colors"
                      aria-label="Reculer 10 secondes">
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                        <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                        <text x="12" y="16" textAnchor="middle" fontSize="5" fill="white" fontWeight="bold">10</text>
                      </svg>
                    </button>
                    <button onClick={handlePauseResume}
                      className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform relative"
                      aria-label={isPlayingReady ? 'Pause' : 'Lecture'}>
                      {isPlayingReady
                        ? <svg className="w-7 h-7 fill-primary-700" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                        : <svg className="w-7 h-7 fill-primary-700 ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                      {isPlayingReady && <span className="absolute inset-0 rounded-full bg-white/30 pulse-ring" />}
                    </button>
                    <button onClick={() => handleSkip(10)}
                      className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition-colors"
                      aria-label="Avancer 10 secondes">
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                        <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8V1l-5 5 5 5V7c3.31 0 6 2.69 6 6z"/>
                        <text x="12" y="16" textAnchor="middle" fontSize="5" fill="white" fontWeight="bold">10</text>
                      </svg>
                    </button>
                  </div>
                  {!isPlayingReady && audioDuration > 0 && audioCurrentTime >= audioDuration - 0.5 && (
                    <p className="text-center text-white/60 text-xs flex items-center justify-center gap-1.5">
                      <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                      </svg>
                      Lecture terminée
                    </p>
                  )}
                </div>
              )}

              {/* ── STREAMING (fallback) ── */}
              {audioPhase === 'streaming' && (
                <div className="flex flex-col items-center gap-4">
                  {!streamPlaying && (
                    <p className="text-sm text-white/70 text-center">Mode flux · connexion lente détectée</p>
                  )}
                  <div className="flex items-center gap-5">
                    <button onClick={() => { handleStop(); setTimeout(startStreaming, 50) }}
                      className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                      aria-label="Rejouer">
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                      </svg>
                    </button>
                    <button onClick={streamPlaying ? handlePauseResume : startStreaming}
                      className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform relative">
                      {streamPlaying && !streamPaused
                        ? <svg className="w-7 h-7 fill-primary-700" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                        : <svg className="w-7 h-7 fill-primary-700 ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>}
                      {streamPlaying && !streamPaused && <span className="absolute inset-0 rounded-full bg-white/30 pulse-ring" />}
                    </button>
                    <button onClick={handleStop}
                      disabled={!streamPlaying}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${streamPlaying ? 'bg-white/20 hover:bg-white/30' : 'bg-white/10 opacity-40 cursor-not-allowed'}`}
                      aria-label="Arrêter">
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
                    </button>
                  </div>
                </div>
              )}
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

            {/* Translated text with chunk highlighting */}
            <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Texte traduit</p>
                <button onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-primary-600 font-semibold hover:text-primary-700 transition-colors">
                  {copied
                    ? <><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>Copié !</>
                    : <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Copier</>}
                </button>
              </div>
              <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
                {chunks.map((chunk, idx) => (
                  <span key={idx}
                    className={isActuallyPlaying && activeChunk === idx
                      ? 'bg-primary-100 text-primary-800 rounded px-0.5 transition-colors duration-200'
                      : 'transition-colors duration-200'}>
                    {chunk}{' '}
                  </span>
                ))}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Fixed bottom */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 bg-white border-t border-gray-100 safe-bottom shadow-card-lg">
        <button onClick={handleStartOver}
          className="w-full flex items-center justify-center gap-2 border-2 border-primary-600 text-primary-700 rounded-2xl py-4 font-bold text-base hover:bg-primary-50 active:bg-primary-100 transition-colors">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Traduire un autre document
        </button>
      </div>
    </div>

    {/* Image zoom modal */}
    {imgModalOpen && imagePreview && (
      <div className="fixed inset-0 z-50 bg-black flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-black/60 backdrop-blur-sm">
          <button onClick={() => setImgModalOpen(false)}
            className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <button onClick={() => setImgZoom(z => Math.max(z - 0.5, 0.5))} disabled={imgZoom <= 0.5}
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white text-xl font-light disabled:opacity-30">−</button>
            <button onClick={() => setImgZoom(1)}
              className="px-3 py-1.5 rounded-xl bg-white/15 text-white text-xs font-semibold min-w-[3.5rem] text-center">
              {Math.round(imgZoom * 100)}%</button>
            <button onClick={() => setImgZoom(z => Math.min(z + 0.5, 5))} disabled={imgZoom >= 5}
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white text-xl font-light disabled:opacity-30">+</button>
          </div>
          <button onClick={() => setImgZoom(1)} className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-auto" style={{ cursor: imgZoom > 1 ? 'grab' : 'default' }}>
          <div className="min-h-full flex items-center justify-center p-4"
            style={{ minWidth: imgZoom > 1 ? `${imgZoom * 100}%` : '100%' }}>
            <img src={imagePreview} alt="document" draggable={false}
              style={{ transform: `scale(${imgZoom})`, transformOrigin: 'center center',
                transition: 'transform 0.2s ease', maxWidth: imgZoom <= 1 ? '100%' : 'none',
                display: 'block', userSelect: 'none' }}
            />
          </div>
        </div>
      </div>
    )}
    </>
  )
}

function ScanIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
    </svg>
  )
}

function TranslateIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5h12M9 3v2m1.048 9.5A18.022 18.022 0 016.412 9m6.088 9h7M11 21l5-10 5 10M12.751 5C11.783 10.77 8.07 15.61 3 18.129" />
    </svg>
  )
}

function ProgressItem({ label, icon, progress, done, disabled }) {
  return (
    <div className={`rounded-2xl p-4 border transition-colors ${
      disabled ? 'opacity-40 bg-gray-50 border-gray-100'
      : done    ? 'bg-green-50 border-green-200'
      :           'bg-white border-primary-100 shadow-card'
    }`}>
      <div className="flex items-center gap-3 mb-2.5">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
          done    ? 'bg-green-100 text-green-600'
          : disabled ? 'bg-gray-100 text-gray-400'
          :           'bg-primary-100 text-primary-600'
        } ${!disabled && !done ? 'spin-slow' : ''}`}>
          {done
            ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
            : icon}
        </div>
        <p className="text-sm font-semibold text-gray-700 flex-1">{label}</p>
        <span className={`text-xs font-bold ${done ? 'text-green-600' : 'text-primary-600'}`}>{progress}%</span>
      </div>
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${done ? 'bg-green-500' : 'bg-primary-500'}`}
          style={{ width: `${progress}%` }} />
      </div>
    </div>
  )
}
