import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  speak, stopSpeech, pauseSpeech, resumeSpeech,
  splitIntoChunks, generateAudio,
} from '../services/tts'

const SPEEDS = [0.6, 0.8, 1.0, 1.2, 1.5]

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
  ocrProgress,
  translateProgress,
  isProcessing,
  error,
  onStartOver,
  onBack,
}) {
  /* ── processing phase ── */
  const isReady   = !isProcessing && !error && translatedText
  const ocrDone   = ocrProgress >= 100
  const transDone = translateProgress >= 100
  const verifying = isProcessing && ocrDone && transDone

  /* ── audio-generation phase ── */
  // 'idle' | 'loading' | 'ready' | 'streaming'
  const [audioPhase,    setAudioPhase]    = useState('idle')
  const [loadProgress,  setLoadProgress]  = useState(0)
  const [ttsError,      setTtsError]      = useState(null)
  const [speedIndex,    setSpeedIndex]    = useState(2)
  const [copied,        setCopied]        = useState(false)

  /* ── ready-mode state ── */
  const [audioDuration,    setAudioDuration]    = useState(0)
  const [audioCurrentTime, setAudioCurrentTime] = useState(0)
  const [isPlayingReady,   setIsPlayingReady]   = useState(false)

  /* ── streaming-mode state ── */
  const [streamPlaying, setStreamPlaying] = useState(false)
  const [streamPaused,  setStreamPaused]  = useState(false)
  const [streamChunk,   setStreamChunk]   = useState(-1)

  const audioRef    = useRef(null)
  const audioUrlRef = useRef(null)   // ref so cleanup always gets the latest URL
  const abortRef    = useRef(null)

  /* ── text chunks ── */
  const chunks = useMemo(
    () => (translatedText ? splitIntoChunks(translatedText) : []),
    [translatedText],
  )

  // Cumulative char offsets for time-based chunk highlighting in ready mode
  const { chunkOffsets, totalChars } = useMemo(() => {
    let offset = 0
    const offsets = chunks.map((c) => {
      const start = offset
      offset += c.length + 1  // +1 for space
      return start
    })
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

  /* ── cleanup on unmount ── */
  useEffect(() => () => {
    stopSpeech()
    abortRef.current?.abort()
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    if (audioRef.current) audioRef.current.pause()
  }, [])

  /* ── audio element events (only wired when ready) ── */
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || audioPhase !== 'ready') return

    const onTimeUpdate     = () => setAudioCurrentTime(audio.currentTime)
    const onDurationChange = () => setAudioDuration(isFinite(audio.duration) ? audio.duration : 0)
    const onEnded          = () => { setIsPlayingReady(false) }
    const onPlay           = () => setIsPlayingReady(true)
    const onPause          = () => setIsPlayingReady(false)
    const onError          = () => {
      setTtsError('Erreur de lecture audio. Réessayez.')
      setIsPlayingReady(false)
    }

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
  }, [audioPhase])

  /* ── start streaming fallback ── */
  const startStreaming = useCallback(() => {
    speak(translatedText, targetLang.tts, {
      rate: SPEEDS[speedIndex],
      onEnd:        () => { setStreamPlaying(false); setStreamPaused(false) },
      onError:      (err) => { setStreamPlaying(false); setStreamPaused(false); setTtsError(err.message) },
      onChunkStart: (idx) => setStreamChunk(idx),
    })
    setStreamPlaying(true)
    setStreamPaused(false)
    setStreamChunk(0)
  }, [translatedText, targetLang, speedIndex])

  /* ── main play button ── */
  const handlePlayClick = useCallback(async () => {
    if (!translatedText || !isReady) return
    setTtsError(null)

    // If already in ready mode: toggle play / pause
    if (audioPhase === 'ready' && audioRef.current) {
      if (isPlayingReady) {
        audioRef.current.pause()
      } else {
        try { await audioRef.current.play() }
        catch { setTtsError('Lecture bloquée. Réessayez.') }
      }
      return
    }

    // Start generating audio
    const abort = new AbortController()
    abortRef.current = abort
    setAudioPhase('loading')
    setLoadProgress(0)

    const result = await generateAudio(translatedText, targetLang.tts, {
      onProgress: (pct) => setLoadProgress(pct),
      signal: abort.signal,
    })

    if (abort.signal.aborted) return

    if (!result) {
      // Lingva unavailable → stream chunk-by-chunk (existing approach)
      setAudioPhase('streaming')
      startStreaming()
      return
    }

    // Build a single audio blob URL
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
    const url = URL.createObjectURL(result.blob)
    audioUrlRef.current = url
    setAudioPhase('ready')
    setAudioCurrentTime(0)

    // Set src + auto-play
    const audio = audioRef.current
    if (audio) {
      audio.src = url
      audio.playbackRate = SPEEDS[speedIndex]
      audio.load()
      try { await audio.play() }
      catch { setTtsError('Lecture bloquée par le navigateur. Appuyez à nouveau sur Play.') }
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
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
    }
    setIsPlayingReady(false)
    setAudioCurrentTime(0)
  }, [])

  const handleSeek = (e) => {
    const t = parseFloat(e.target.value)
    if (audioRef.current) audioRef.current.currentTime = t
    setAudioCurrentTime(t)
  }

  const handleSkip = (delta) => {
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
        onEnd:        () => { setStreamPlaying(false); setStreamPaused(false) },
        onError:      (err) => { setStreamPlaying(false); setStreamPaused(false); setTtsError(err.message) },
        onChunkStart: (idx) => setStreamChunk(idx),
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
    navigator.clipboard.writeText(translatedText).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  const handleBack = () => { handleStop(); onBack() }
  const handleStartOver = () => { handleStop(); onStartOver() }

  /* streaming playing/paused state */
  const streamActive = audioPhase === 'streaming'
  const isActuallyPlaying = (audioPhase === 'ready' && isPlayingReady) ||
                            (streamActive && streamPlaying && !streamPaused)

  /* ── render ── */
  return (
    <div className="flex flex-col min-h-screen bg-white">

      {/* Hidden native audio element — src set dynamically */}
      <audio ref={audioRef} preload="auto" />

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 bg-gradient-to-b from-primary-50 to-white sticky top-0 z-10">
        <button
          onClick={handleBack}
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

        {/* ── OCR + Translation progress ── */}
        {isProcessing && (
          <div className="space-y-3 mt-2">
            <ProgressItem label="Lecture du document"        icon={<ScanIcon />}      progress={ocrProgress}       done={ocrDone} />
            <ProgressItem label={`Traduction en ${targetLang.name}`} icon={<TranslateIcon />} progress={ocrDone ? translateProgress : 0} done={transDone} disabled={!ocrDone} />
            {verifying && (
              <div className="bg-primary-50 border border-primary-100 rounded-2xl p-4 flex items-center gap-3">
                <svg className="w-5 h-5 text-primary-600 spin-slow shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
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
            <button onClick={handleStartOver} className="mt-4 w-full bg-red-600 hover:bg-red-700 text-white rounded-xl py-3 font-bold text-sm transition-colors">
              Réessayer
            </button>
          </div>
        )}

        {/* ── Audio player (shown once processing done) ── */}
        {isReady && (
          <div className="mt-2 space-y-4">

            {/* ── Player card ── */}
            <div className="bg-gradient-to-br from-primary-600 to-primary-800 rounded-3xl p-6 text-white shadow-blue">

              {/* Flag + language */}
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{targetLang.flag}</span>
                  <span className="font-bold text-base">{targetLang.name}</span>
                </div>
                {/* Speed badge */}
                <button
                  onClick={handleSpeedChange}
                  className="px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 transition-colors text-xs font-bold"
                >
                  {SPEEDS[speedIndex]}×
                </button>
              </div>

              {/* ── IDLE ── */}
              {audioPhase === 'idle' && (
                <button
                  onClick={handlePlayClick}
                  className="w-full flex items-center justify-center gap-3 bg-white text-primary-700 rounded-2xl py-4 font-bold text-base shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-transform"
                >
                  <svg className="w-6 h-6 fill-primary-700 ml-1" viewBox="0 0 24 24">
                    <path d="M8 5v14l11-7z"/>
                  </svg>
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
                    <div
                      className="h-full bg-white rounded-full transition-all duration-300"
                      style={{ width: `${loadProgress}%` }}
                    />
                  </div>
                  <button
                    onClick={handleCancelLoad}
                    className="w-full text-center text-white/60 text-sm py-1 hover:text-white transition-colors"
                  >
                    Annuler
                  </button>
                </div>
              )}

              {/* ── READY (pre-generated blob) ── */}
              {audioPhase === 'ready' && (
                <div className="space-y-4">
                  {/* Scrubber */}
                  <div className="space-y-1">
                    <input
                      type="range"
                      min={0}
                      max={audioDuration || 1}
                      value={audioCurrentTime}
                      step={0.5}
                      onChange={handleSeek}
                      className="w-full h-1 rounded-full cursor-pointer appearance-none"
                      style={{ accentColor: 'white' }}
                    />
                    <div className="flex justify-between text-xs text-white/60">
                      <span>{formatTime(audioCurrentTime)}</span>
                      <span>{formatTime(audioDuration)}</span>
                    </div>
                  </div>

                  {/* Controls */}
                  <div className="flex items-center justify-between gap-2">
                    {/* Skip -10s */}
                    <button
                      onClick={() => handleSkip(-10)}
                      className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition-colors"
                      aria-label="Reculer 10 secondes"
                    >
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                        <path d="M11.99 5V1l-5 5 5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6h-2c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                        <text x="12" y="16" textAnchor="middle" fontSize="5" fill="white" fontWeight="bold">10</text>
                      </svg>
                    </button>

                    {/* Play / Pause */}
                    <button
                      onClick={handlePauseResume}
                      className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform relative"
                      aria-label={isPlayingReady ? 'Pause' : 'Lecture'}
                    >
                      {isPlayingReady ? (
                        <svg className="w-7 h-7 fill-primary-700" viewBox="0 0 24 24">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                        </svg>
                      ) : (
                        <svg className="w-7 h-7 fill-primary-700 ml-1" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      )}
                      {isPlayingReady && (
                        <span className="absolute inset-0 rounded-full bg-white/30 pulse-ring" />
                      )}
                    </button>

                    {/* Skip +10s */}
                    <button
                      onClick={() => handleSkip(10)}
                      className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition-colors"
                      aria-label="Avancer 10 secondes"
                    >
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                        <path d="M18 13c0 3.31-2.69 6-6 6s-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8V1l-5 5 5 5V7c3.31 0 6 2.69 6 6z"/>
                        <text x="12" y="16" textAnchor="middle" fontSize="5" fill="white" fontWeight="bold">10</text>
                      </svg>
                    </button>

                    {/* Download */}
                    <button
                      onClick={handleDownload}
                      className="w-11 h-11 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 flex items-center justify-center transition-colors"
                      aria-label="Télécharger l'audio"
                    >
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                        <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                      </svg>
                    </button>
                  </div>

                  {/* Download label */}
                  <p className="text-center text-white/50 text-xs">
                    Appui long sur ↓ pour enregistrer le fichier MP3
                  </p>
                </div>
              )}

              {/* ── STREAMING (Lingva fallback, no scrubber) ── */}
              {audioPhase === 'streaming' && (
                <div className="flex flex-col items-center gap-4">
                  {!streamPlaying && (
                    <p className="text-sm text-white/70 text-center">
                      Mode flux · connexion lente détectée
                    </p>
                  )}
                  <div className="flex items-center gap-5">
                    {/* Replay */}
                    <button
                      onClick={() => { handleStop(); setTimeout(startStreaming, 50) }}
                      className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                      aria-label="Rejouer"
                    >
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                        <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                      </svg>
                    </button>

                    {/* Play / Pause */}
                    <button
                      onClick={streamPlaying ? handlePauseResume : startStreaming}
                      className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform relative"
                    >
                      {streamPlaying && !streamPaused ? (
                        <svg className="w-7 h-7 fill-primary-700" viewBox="0 0 24 24">
                          <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                        </svg>
                      ) : (
                        <svg className="w-7 h-7 fill-primary-700 ml-1" viewBox="0 0 24 24">
                          <path d="M8 5v14l11-7z"/>
                        </svg>
                      )}
                      {streamPlaying && !streamPaused && (
                        <span className="absolute inset-0 rounded-full bg-white/30 pulse-ring" />
                      )}
                    </button>

                    {/* Stop */}
                    <button
                      onClick={handleStop}
                      disabled={!streamPlaying}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-colors ${
                        streamPlaying ? 'bg-white/20 hover:bg-white/30' : 'bg-white/10 opacity-40 cursor-not-allowed'
                      }`}
                      aria-label="Arrêter"
                    >
                      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                        <path d="M6 6h12v12H6z"/>
                      </svg>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* ── TTS error ── */}
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
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Texte traduit</p>
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-primary-600 font-semibold hover:text-primary-700 transition-colors"
                >
                  {copied ? (
                    <><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>Copié !</>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copier</>
                  )}
                </button>
              </div>

              <p className="text-gray-700 text-sm leading-relaxed">
                {chunks.map((chunk, idx) => (
                  <span
                    key={idx}
                    className={
                      isActuallyPlaying && activeChunk === idx
                        ? 'bg-primary-100 text-primary-800 rounded px-0.5 transition-colors duration-200'
                        : 'transition-colors duration-200'
                    }
                  >
                    {chunk}{' '}
                  </span>
                ))}
              </p>

              {!isActuallyPlaying && audioPhase === 'ready' && audioDuration > 0 && audioCurrentTime >= audioDuration - 0.5 && (
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
      <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 bg-white border-t border-gray-100 safe-bottom shadow-card-lg">
        <button
          onClick={handleStartOver}
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

/* ── Progress bar item ────────────────────────────────── */
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
            ? <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
            : icon}
        </div>
        <p className="text-sm font-semibold text-gray-700 flex-1">{label}</p>
        <span className={`text-xs font-bold ${done ? 'text-green-600' : 'text-primary-600'}`}>{progress}%</span>
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
