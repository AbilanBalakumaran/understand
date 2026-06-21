import { useState, useMemo, useEffect } from 'react'
import { TARGET_LANGUAGES } from '../data/languages'
import { useAppLang } from '../context/AppLang'

const STORAGE_KEY  = 'understand_lastTargetLang'
const RECENT_KEY   = 'understand_recentTargets'
const MAX_RECENT   = 5

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

function loadRecentTargets() {
  try {
    const codes = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    return codes.map((c) => TARGET_LANGUAGES.find((l) => l.code === c)).filter(Boolean)
  } catch {
    return []
  }
}

function saveRecentTarget(lang) {
  try {
    const existing = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    const updated  = [lang.code, ...existing.filter((c) => c !== lang.code)].slice(0, MAX_RECENT)
    localStorage.setItem(RECENT_KEY, JSON.stringify(updated))
  } catch {}
}

const UI = {
  fr: {
    title:    'Choisissez votre langue',
    step:     'Étape 2 / 3',
    recent:   'Récentes',
    yourLang: "Votre langue — l'audio sera dans cette langue",
    saved:    'Mémorisée',
    search:   'Rechercher une langue…',
    noResult: (q) => `Aucune langue trouvée pour « ${q} »`,
    selected: 'Langue sélectionnée',
    create:   "Créer l'audio",
    zoomIn:   'Agrandir',
    zoomOut:  'Réduire',
    closeModal:'Fermer',
    reset:    '1:1',
  },
  en: {
    title:    'Choose your language',
    step:     'Step 2 / 3',
    recent:   'Recent',
    yourLang: 'Your language — audio will be in this language',
    saved:    'Saved',
    search:   'Search a language…',
    noResult: (q) => `No language found for "${q}"`,
    selected: 'Selected language',
    create:   'Create audio',
    zoomIn:   'Zoom in',
    zoomOut:  'Zoom out',
    closeModal:'Close',
    reset:    '1:1',
  },
}

export default function LanguageSelect({
  imagePreview,
  onConfirm,
  onBack,
}) {
  const { lang: appLang } = useAppLang()
  const t = UI[appLang] || UI.fr

  const [search, setSearch]                 = useState('')
  const [selectedTarget, setSelectedTarget] = useState(() => loadLastTarget())
  const [recentTargets, setRecentTargets]   = useState(() => loadRecentTargets())

  // Image zoom modal
  const [modalOpen, setModalOpen] = useState(false)
  const [zoom, setZoom]           = useState(1)

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
    saveRecentTarget(lang)
    // Update recent list in state immediately
    setRecentTargets((prev) => {
      const updated = [lang, ...prev.filter((l) => l.code !== lang.code)].slice(0, MAX_RECENT)
      return updated
    })
  }

  const handleConfirm = () => {
    if (!selectedTarget) return
    onConfirm({ targetLang: selectedTarget })
  }

  // Recently used to show at top (only when not searching)
  const showRecent = !search && recentTargets.length > 0

  return (
    <>
      <div className="flex flex-col min-h-screen bg-white">

        {/* ── Blue header (consistent across all pages) ── */}
        <div
          className="flex items-center gap-3 px-4 pb-4 sticky top-0 z-10"
          style={{
            background: 'var(--color-brand)',
            paddingTop: 'max(48px, calc(env(safe-area-inset-top, 0px) + 12px))',
          }}
        >
          <button
            onClick={onBack}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-white/15 hover:bg-white/25 active:bg-white/35 transition-colors"
            aria-label="Retour"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h2 className="font-bold text-white text-lg leading-tight">{t.title}</h2>
            <p className="text-white/60 text-xs">{t.step}</p>
          </div>

          {/* Thumbnail — tap to open zoom modal */}
          {imagePreview && (
            <button
              onClick={() => setModalOpen(true)}
              className="rounded-xl border-2 border-white/30 overflow-hidden hover:opacity-80 active:opacity-60 transition-opacity"
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

          {/* ── Recently used languages ── */}
          {showRecent && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
                {t.recent}
              </p>
              <div className="flex gap-2 flex-wrap">
                {recentTargets.map((lang) => {
                  const isSelected = selectedTarget?.code === lang.code
                  return (
                    <button
                      key={lang.code}
                      onClick={() => handleSelectTarget(lang)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all text-sm font-semibold ${
                        isSelected
                          ? 'bg-primary-600 text-white border-primary-600 shadow-blue'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50 active:bg-gray-100'
                      }`}
                    >
                      <span className="text-base">{lang.flag}</span>
                      <span>{langName(lang)}</span>
                      {isSelected && (
                        <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

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
          <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-black/60 backdrop-blur-sm">
            <button
              onClick={() => setModalOpen(false)}
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 active:bg-white/35 flex items-center justify-center transition-colors"
              aria-label={t.closeModal}
            >
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setZoom((z) => Math.max(z - 0.5, 0.5))}
                disabled={zoom <= 0.5}
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white text-xl font-light transition-colors disabled:opacity-30"
              >−</button>
              <button
                onClick={() => setZoom(1)}
                className="px-3 py-1.5 rounded-xl bg-white/15 hover:bg-white/25 text-white text-xs font-semibold transition-colors min-w-[3.5rem] text-center"
              >
                {Math.round(zoom * 100)}%
              </button>
              <button
                onClick={() => setZoom((z) => Math.min(z + 0.5, 5))}
                disabled={zoom >= 5}
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white text-xl font-light transition-colors disabled:opacity-30"
              >+</button>
            </div>
            <button
              onClick={() => setZoom(1)}
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center transition-colors"
            >
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/>
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-auto" style={{ cursor: zoom > 1 ? 'grab' : 'default' }}>
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
