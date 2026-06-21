import { useState, useMemo, useEffect } from 'react'
import { TARGET_LANGUAGES, SOURCE_LANGUAGES } from '../data/languages'
import { useAppLang } from '../context/AppLang'

const STORAGE_KEY = 'understand_lastTargetLang'

function loadLastTarget() {
  try {
    const code = localStorage.getItem(STORAGE_KEY)
    return code ? TARGET_LANGUAGES.find((l) => l.code === code) || null : null
  } catch {
    return null
  }
}

function saveLastTarget(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang.code) } catch {}
}

const UI = {
  fr: {
    title:        'Choisissez votre langue',
    step:         'Étape 2 / 3',
    docLang:      'Langue du document',
    detecting:    'Détection de la langue en cours…',
    autoDetected: 'Auto-détecté',
    editable:     'Modifiable ci-dessous',
    detected:     'Détecté',
    auto:         'Auto',
    yourLang:     "Votre langue — l'audio sera dans cette langue",
    saved:        'Mémorisée',
    search:       'Rechercher une langue…',
    noResult:     (q) => `Aucune langue trouvée pour « ${q} »`,
    selected:     'Langue sélectionnée',
    create:       "Créer l'audio",
    uncertain:    'Incertain',
    confirmHint:  'Veuillez vérifier — détection peu fiable',
    zoomIn:       'Agrandir',
    zoomOut:      'Réduire',
    closeModal:   'Fermer',
    reset:        '1:1',
  },
  en: {
    title:        'Choose your language',
    step:         'Step 2 / 3',
    docLang:      'Document language',
    detecting:    'Detecting language…',
    autoDetected: 'Auto-detected',
    editable:     'Editable below',
    detected:     'Detected',
    auto:         'Auto',
    yourLang:     'Your language — audio will be in this language',
    saved:        'Saved',
    search:       'Search a language…',
    noResult:     (q) => `No language found for "${q}"`,
    selected:     'Selected language',
    create:       'Create audio',
    uncertain:    'Uncertain',
    confirmHint:  'Please verify — low-confidence detection',
    zoomIn:       'Zoom in',
    zoomOut:      'Zoom out',
    closeModal:   'Close',
    reset:        '1:1',
  },
}

// Confidence below this threshold triggers the "please verify" warning
const CONFIDENCE_THRESHOLD = 0.55

export default function LanguageSelect({
  imagePreview,
  onConfirm,
  onBack,
  detectedLang,        // SOURCE_LANGUAGES object | null
  isDetecting,         // boolean
  detectionConfidence, // 0–1
}) {
  const { lang: appLang } = useAppLang()
  const t = UI[appLang] || UI.fr

  const [search, setSearch]               = useState('')
  const [selectedTarget, setSelectedTarget] = useState(() => loadLastTarget())
  const [selectedSource, setSelectedSource] = useState(SOURCE_LANGUAGES[1])
  const [showSourcePicker, setShowSourcePicker] = useState(false)

  // Image zoom modal
  const [modalOpen, setModalOpen] = useState(false)
  const [zoom, setZoom]           = useState(1)

  const isUncertain = Boolean(
    detectedLang && !isDetecting && detectionConfidence < CONFIDENCE_THRESHOLD
  )

  // Auto-select detected source language when detection finishes
  useEffect(() => {
    if (detectedLang && !isDetecting) {
      setSelectedSource(detectedLang)
    }
  }, [detectedLang, isDetecting])

  // Reset zoom when modal opens
  useEffect(() => {
    if (modalOpen) setZoom(1)
  }, [modalOpen])

  // Close modal on Escape
  useEffect(() => {
    if (!modalOpen) return
    const handler = (e) => { if (e.key === 'Escape') setModalOpen(false) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [modalOpen])

  const langName = (l) => appLang === 'fr' ? (l.nameFr || l.name) : l.name

  const filteredLanguages = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return TARGET_LANGUAGES
    return TARGET_LANGUAGES.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.nameFr && l.nameFr.toLowerCase().includes(q)) ||
        l.code.toLowerCase().includes(q)
    )
  }, [search])

  const handleSelectTarget = (lang) => {
    setSelectedTarget(lang)
    saveLastTarget(lang)
  }

  const handleConfirm = () => {
    if (!selectedTarget) return
    onConfirm({ sourceLang: selectedSource, targetLang: selectedTarget })
  }

  return (
    <>
      <div className="flex flex-col min-h-screen bg-white">

        {/* ── Top bar ── */}
        <div
          className="flex items-center gap-3 px-4 pb-4 bg-white border-b border-gray-100 sticky top-0 z-10 shadow-sm"
          style={{ paddingTop: 'max(48px, calc(env(safe-area-inset-top, 0px) + 12px))' }}
        >
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors"
            aria-label="Retour"
          >
            <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h2 className="font-bold text-gray-900 text-lg leading-tight">{t.title}</h2>
            <p className="text-gray-400 text-xs">{t.step}</p>
          </div>

          {/* Thumbnail — tap to open zoom modal */}
          {imagePreview && (
            <button
              onClick={() => setModalOpen(true)}
              className="ml-auto rounded-xl border border-gray-200 overflow-hidden hover:opacity-80 active:opacity-60 transition-opacity focus-visible:ring-2 focus-visible:ring-primary-500"
              aria-label={t.zoomIn}
              style={{ WebkitTapHighlightColor: 'transparent' }}
            >
              <img
                src={imagePreview}
                alt="document"
                className="w-10 h-12 object-cover block"
              />
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-4 pt-4 pb-36">

          {/* ── Source language ── */}
          <div className="mb-6">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
              {t.docLang}
            </p>

            {/* Detection spinner */}
            {isDetecting && (
              <div className="flex items-center gap-3 bg-primary-50 rounded-2xl px-4 py-3.5 mb-2.5 border border-primary-100">
                <svg className="w-4 h-4 text-primary-500 spin-slow shrink-0" viewBox="0 0 24 24" fill="none">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                    strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
                </svg>
                <p className="text-sm text-primary-700 font-medium">{t.detecting}</p>
              </div>
            )}

            {/* Auto-detected badge — green if confident, amber if uncertain */}
            {detectedLang && !isDetecting && (
              <div className="flex items-center gap-2 mb-2.5 px-0.5">
                {isUncertain ? (
                  <span className="flex items-center gap-1.5 bg-amber-50 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-amber-200">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                    </svg>
                    {t.uncertain}
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {t.autoDetected}
                  </span>
                )}
                <p className="text-xs text-gray-400">
                  {isUncertain ? t.confirmHint : t.editable}
                </p>
              </div>
            )}

            {/* Source selector */}
            <button
              onClick={() => setShowSourcePicker(!showSourcePicker)}
              className="flex items-center gap-3 w-full bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-2xl px-4 py-3.5 border border-gray-200 transition-colors"
            >
              <span className="text-xl">{selectedSource.flag}</span>
              <span className="text-gray-700 font-semibold text-sm flex-1 text-left">{langName(selectedSource)}</span>
              {detectedLang && selectedSource.code === detectedLang.code && !isDetecting && (
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  isUncertain
                    ? 'text-amber-700 bg-amber-50'
                    : 'text-primary-600 bg-primary-50'
                }`}>
                  {t.detected}
                </span>
              )}
              <svg
                className={`w-4 h-4 text-gray-400 transition-transform ${showSourcePicker ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showSourcePicker && (
              <div className="mt-2 bg-white border border-gray-200 rounded-2xl shadow-card-lg overflow-hidden">
                {SOURCE_LANGUAGES.map((lang) => (
                  <button
                    key={lang.code}
                    onClick={() => { setSelectedSource(lang); setShowSourcePicker(false) }}
                    className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50 active:bg-gray-100 transition-colors text-left ${
                      selectedSource.code === lang.code ? 'bg-primary-50' : ''
                    }`}
                  >
                    <span className="text-xl">{lang.flag}</span>
                    <span className="text-sm text-gray-700 font-medium flex-1">{langName(lang)}</span>
                    {lang.code === detectedLang?.code && (
                      <span className="text-xs text-green-600 font-semibold mr-1">{t.auto}</span>
                    )}
                    {selectedSource.code === lang.code && (
                      <svg className="w-4 h-4 text-primary-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* ── Target language ── */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">
                {t.yourLang}
              </p>
              {selectedTarget && (
                <span className="text-xs text-primary-600 font-semibold">
                  {selectedTarget.flag} {t.saved}
                </span>
              )}
            </div>

            {/* Search */}
            <div className="relative mb-4">
              <svg className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                placeholder={t.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              />
            </div>

            {/* Language grid */}
            <div className="grid grid-cols-3 gap-2 lang-grid">
              {filteredLanguages.map((lang) => {
                const isSelected = selectedTarget?.code === lang.code
                return (
                  <button
                    key={lang.code}
                    onClick={() => handleSelectTarget(lang)}
                    className={`
                      flex flex-col items-center gap-1.5 rounded-2xl p-3 transition-all
                      ${isSelected
                        ? 'bg-primary-600 text-white shadow-blue scale-105'
                        : 'bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-gray-700 border border-gray-100'
                      }
                    `}
                  >
                    <span className="text-2xl leading-none">{lang.flag}</span>
                    <span className={`text-xs font-medium text-center leading-tight line-clamp-2 ${isSelected ? 'text-white' : 'text-gray-600'}`}>
                      {langName(lang)}
                    </span>
                    {isSelected && (
                      <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                )
              })}
              {filteredLanguages.length === 0 && (
                <div className="col-span-3 py-10 text-center text-gray-400 text-sm">
                  {t.noResult(search)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Fixed bottom CTA ── */}
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 bg-white border-t border-gray-100 safe-bottom shadow-card-lg">
          {selectedTarget && (
            <div className="flex items-center gap-3 mb-3 bg-primary-50 rounded-2xl px-4 py-3 border border-primary-100">
              <span className="text-xl">{selectedTarget.flag}</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-gray-400">{t.selected}</p>
                <p className="text-sm font-bold text-primary-700 truncate">{langName(selectedTarget)}</p>
              </div>
              <svg className="w-5 h-5 text-primary-500 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
              </svg>
            </div>
          )}
          <button
            onClick={handleConfirm}
            disabled={!selectedTarget}
            className={`
              w-full flex items-center justify-center gap-2.5 rounded-2xl py-4 text-base font-bold transition-all
              ${selectedTarget
                ? 'bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white shadow-blue'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
              <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/>
            </svg>
            {t.create}
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Document zoom modal ── */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black flex flex-col"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
        >
          {/* Control bar */}
          <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-black/60 backdrop-blur-sm">
            {/* Close */}
            <button
              onClick={() => setModalOpen(false)}
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 flex items-center justify-center transition-colors"
              aria-label={t.closeModal}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>

            {/* Zoom controls */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.5, 0.5))}
                disabled={zoom <= 0.5}
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 flex items-center justify-center text-white text-xl font-light transition-colors disabled:opacity-30"
                aria-label={t.zoomOut}
              >−</button>

              <button
                onClick={() => setZoom(1)}
                className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 active:bg-white/35 text-white text-xs font-semibold transition-colors min-w-[3.5rem] text-center"
              >
                {Math.round(zoom * 100)}%
              </button>

              <button
                onClick={() => setZoom((z) => Math.min(z + 0.5, 5))}
                disabled={zoom >= 5}
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 flex items-center justify-center text-white text-xl font-light transition-colors disabled:opacity-30"
                aria-label={t.zoomIn}
              >+</button>
            </div>

            {/* Reset zoom */}
            <button
              onClick={() => setZoom(1)}
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 flex items-center justify-center transition-colors"
              aria-label={t.reset}
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/>
              </svg>
            </button>
          </div>

          {/* Scrollable / zoomable image area */}
          <div
            className="flex-1 overflow-auto"
            style={{ cursor: zoom > 1 ? 'grab' : 'default' }}
          >
            <div
              className="min-h-full flex items-center justify-center p-4"
              style={{ minWidth: zoom > 1 ? `${zoom * 100}%` : '100%' }}
            >
              <img
                src={imagePreview}
                alt="document"
                draggable={false}
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: 'center center',
                  transition: 'transform 0.2s ease',
                  maxWidth: zoom <= 1 ? '100%' : 'none',
                  display: 'block',
                  userSelect: 'none',
                }}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
