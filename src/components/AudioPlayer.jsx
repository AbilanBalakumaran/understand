import { useState, useEffect, useMemo, useCallback } from 'react'
import { speak, stopSpeech, pauseSpeech, resumeSpeech, splitIntoChunks } from '../services/tts'

const SPEEDS = [0.6, 0.8, 1.0, 1.2, 1.5]

// Maps Google-returned ISO codes to flag + short name
const LANG_DISPLAY = {
  af:['🇿🇦','Afrikaans'], sq:['🇦🇱','Albanais'], am:['🇪🇹','Amharique'],
  ar:['🇸🇦','Arabe'], hy:['🇦🇲','Arménien'], az:['🇦🇿','Azerbaïdjanais'],
  bn:['🇧🇩','Bengali'], bs:['🇧🇦','Bosniaque'], bg:['🇧🇬','Bulgare'],
  ca:['🏴','Catalan'], zh:['🇨🇳','Chinois'], hr:['🇭🇷','Croate'],
  cs:['🇨🇿','Tchèque'], da:['🇩🇰','Danois'], nl:['🇳🇱','Néerlandais'],
  en:['🇬🇧','Anglais'], et:['🇪🇪','Estonien'], fi:['🇫🇮','Finnois'],
  fr:['🇫🇷','Français'], ka:['🇬🇪','Géorgien'], de:['🇩🇪','Allemand'],
  el:['🇬🇷','Grec'], gu:['🇮🇳','Gujarati'], ht:['🇭🇹','Créole'],
  he:['🇮🇱','Hébreu'], hi:['🇮🇳','Hindi'], hu:['🇭🇺','Hongrois'],
  id:['🇮🇩','Indonésien'], ga:['🇮🇪','Irlandais'], it:['🇮🇹','Italien'],
  ja:['🇯🇵','Japonais'], kn:['🇮🇳','Kannada'], ko:['🇰🇷','Coréen'],
  lv:['🇱🇻','Letton'], lt:['🇱🇹','Lituanien'], mk:['🇲🇰','Macédonien'],
  ms:['🇲🇾','Malais'], ml:['🇮🇳','Malayalam'], mt:['🇲🇹','Maltais'],
  mr:['🇮🇳','Marathi'], my:['🇲🇲','Birman'], ne:['🇳🇵','Népalais'],
  no:['🇳🇴','Norvégien'], fa:['🇮🇷','Persan'], pl:['🇵🇱','Polonais'],
  pt:['🇵🇹','Portugais'], pa:['🇮🇳','Pendjabi'], ro:['🇷🇴','Roumain'],
  ru:['🇷🇺','Russe'], sr:['🇷🇸','Serbe'], si:['🇱🇰','Cingalais'],
  sk:['🇸🇰','Slovaque'], sl:['🇸🇮','Slovène'], so:['🇸🇴','Somali'],
  es:['🇪🇸','Espagnol'], sw:['🇰🇪','Swahili'], sv:['🇸🇪','Suédois'],
  tl:['🇵🇭','Filipino'], ta:['🇮🇳','Tamoul'], te:['🇮🇳','Télougou'],
  th:['🇹🇭','Thaï'], tr:['🇹🇷','Turc'], uk:['🇺🇦','Ukrainien'],
  ur:['🇵🇰','Ourdou'], uz:['🇺🇿','Ouzbek'], vi:['🇻🇳','Vietnamien'],
  cy:['🏴󠁧󠁢󠁷󠁬󠁳󠁿','Gallois'], yo:['🇳🇬','Yoruba'], zu:['🇿🇦','Zoulou'],
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

  const [playing,    setPlaying]    = useState(false)
  const [paused,     setPaused]     = useState(false)
  const [activeChunk, setActiveChunk] = useState(-1)
  const [ttsError,   setTtsError]   = useState(null)
  const [speedIndex, setSpeedIndex] = useState(2)
  const [copied,     setCopied]     = useState(false)
  const [imgModalOpen, setImgModalOpen] = useState(false)
  const [imgZoom,    setImgZoom]    = useState(1)

  const chunks = useMemo(
    () => (translatedText ? splitIntoChunks(translatedText) : []),
    [translatedText]
  )

  useEffect(() => () => stopSpeech(), [])

  // ── Play ──────────────────────────────────────────────────────────────────
  // Called synchronously from onClick — never async — so iOS Safari allows
  // audio.play() on the very first chunk without blocking.
  const handlePlay = useCallback(() => {
    if (!isReady) return
    setTtsError(null)
    setPlaying(true)
    setPaused(false)
    setActiveChunk(0)
    speak(translatedText, targetLang.tts, {
      rate: SPEEDS[speedIndex],
      onEnd:        () => { setPlaying(false); setPaused(false); setActiveChunk(-1) },
      onError:      err => { setPlaying(false); setPaused(false); setTtsError(err.message) },
      onChunkStart: idx => setActiveChunk(idx),
    })
  }, [isReady, translatedText, targetLang, speedIndex])

  const handlePauseResume = () => {
    if (paused) { resumeSpeech(); setPaused(false) }
    else        { pauseSpeech();  setPaused(true)  }
  }

  const handleStop = useCallback(() => {
    stopSpeech()
    setPlaying(false)
    setPaused(false)
    setActiveChunk(-1)
  }, [])

  const handleSpeedChange = () => {
    const next = (speedIndex + 1) % SPEEDS.length
    setSpeedIndex(next)
    if (playing) {
      speak(translatedText, targetLang.tts, {
        rate: SPEEDS[next],
        onEnd:        () => { setPlaying(false); setPaused(false); setActiveChunk(-1) },
        onError:      err => { setPlaying(false); setPaused(false); setTtsError(err.message) },
        onChunkStart: idx => setActiveChunk(idx),
      })
    }
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

  const isActuallyPlaying = playing && !paused
  const dl = detectedLang?.split('-')[0]

  return (
    <>
    <div className="flex flex-col min-h-screen bg-white">

      {/* ── Header ── */}
      <div
        className="flex items-center gap-3 px-4 sticky top-0 z-20"
        style={{
          background: 'var(--color-brand)',
          paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
          paddingBottom: '10px',
        }}
      >
        <button
          onClick={handleBack}
          className="w-9 h-9 rounded-full flex items-center justify-center bg-white/15 hover:bg-white/25 active:bg-white/35 transition-colors shrink-0"
          aria-label="Retour"
        >
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
          <button
            onClick={() => { setImgZoom(1); setImgModalOpen(true) }}
            className="rounded-xl border-2 border-white/30 overflow-hidden hover:opacity-80 active:opacity-60 transition-opacity"
          >
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

              {/* Lang badge */}
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-1.5 bg-white/15 rounded-xl px-2.5 py-1 text-sm font-semibold min-w-0 max-w-[75%]">
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
                <button
                  onClick={handleSpeedChange}
                  className="px-3 py-1 rounded-full bg-white/20 hover:bg-white/30 active:bg-white/40 text-xs font-bold"
                >
                  {SPEEDS[speedIndex]}×
                </button>
              </div>

              {/* Controls */}
              {!playing ? (
                /* ── IDLE / STOPPED ── */
                <button
                  onClick={handlePlay}
                  className="w-full flex items-center justify-center gap-3 bg-white text-primary-700 rounded-2xl py-4 font-bold text-base shadow-lg hover:scale-[1.02] active:scale-[0.98] transition-transform"
                >
                  <svg className="w-6 h-6 fill-primary-700 ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                  Écouter
                </button>
              ) : (
                /* ── PLAYING / PAUSED ── */
                <div className="flex items-center justify-center gap-4">
                  {/* Replay */}
                  <button
                    onClick={() => { handleStop(); setTimeout(handlePlay, 50) }}
                    className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                    aria-label="Rejouer"
                  >
                    <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                      <path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/>
                    </svg>
                  </button>

                  {/* Play / Pause */}
                  <button
                    onClick={handlePauseResume}
                    className="w-16 h-16 rounded-full bg-white flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-transform relative"
                  >
                    {isActuallyPlaying ? (
                      <svg className="w-7 h-7 fill-primary-700" viewBox="0 0 24 24"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                    ) : (
                      <svg className="w-7 h-7 fill-primary-700 ml-1" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
                    )}
                    {isActuallyPlaying && <span className="absolute inset-0 rounded-full bg-white/30 pulse-ring" />}
                  </button>

                  {/* Stop */}
                  <button
                    onClick={handleStop}
                    className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                    aria-label="Arrêter"
                  >
                    <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24"><path d="M6 6h12v12H6z"/></svg>
                  </button>
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
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 text-xs text-primary-600 font-semibold hover:text-primary-700"
                >
                  {copied ? (
                    <><svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>Copié !</>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/></svg>Copier</>
                  )}
                </button>
              </div>
              <p className="text-gray-700 text-sm leading-relaxed whitespace-pre-wrap">
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

    {/* ── Image zoom modal ── */}
    {imgModalOpen && imagePreview && (
      <div className="fixed inset-0 z-50 bg-black flex flex-col"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
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
