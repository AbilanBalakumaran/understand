import { useState, useMemo, useEffect, useRef, useCallback } from 'react'
import { TARGET_LANGUAGES } from '../data/languages'
import { useAppLang } from '../context/AppLang'

const STORAGE_KEY  = 'understand_lastTargetLang'
const RECENT_KEY   = 'understand_recentTargets'
const FAV_KEY      = 'understand_favTargets'
const MAX_RECENT   = 5

function loadLastTarget() {
  try {
    const code = localStorage.getItem(STORAGE_KEY)
    return code ? TARGET_LANGUAGES.find((l) => l.code === code) || null : null
  } catch { return null }
}

function saveLastTarget(lang) {
  try { localStorage.setItem(STORAGE_KEY, lang.code) } catch {}
}

function loadList(key) {
  try {
    const codes = JSON.parse(localStorage.getItem(key) || '[]')
    return codes.map((c) => TARGET_LANGUAGES.find((l) => l.code === c)).filter(Boolean)
  } catch { return [] }
}

function saveList(key, langs) {
  try { localStorage.setItem(key, JSON.stringify(langs.map((l) => l.code))) } catch {}
}

const UI = {
  fr: {
    title:       'Choisissez votre langue',
    step:        'Étape 2 / 3',
    favorites:   'Favoris',
    recent:      'Récentes',
    yourLang:    "Votre langue — l'audio sera dans cette langue",
    saved:       'Mémorisée',
    search:      'Rechercher une langue…',
    noResult:    (q) => `Aucune langue trouvée pour « ${q} »`,
    selected:    'Langue sélectionnée',
    create:      "Créer l'audio",
  },
  en: {
    title:       'Choose your language',
    step:        'Step 2 / 3',
    favorites:   'Favorites',
    recent:      'Recent',
    yourLang:    'Your language — audio will be in this language',
    saved:       'Saved',
    search:      'Search a language…',
    noResult:    (q) => `No language found for "${q}"`,
    selected:    'Selected language',
    create:      'Create audio',
  },
}

// Long-press hook: calls onLongPress after `ms` ms of continuous press
function useLongPress(onLongPress, ms = 500) {
  const timer = useRef(null)
  const fired  = useRef(false)

  const start = useCallback((e) => {
    e.preventDefault()
    fired.current = false
    timer.current = setTimeout(() => {
      fired.current = true
      onLongPress()
    }, ms)
  }, [onLongPress, ms])

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  return { onMouseDown: start, onTouchStart: start, onMouseUp: cancel, onMouseLeave: cancel, onTouchEnd: cancel }
}

// Individual language card — supports tap (select) and long press (favorite)
function LangCard({ lang, isSelected, isFavorite, onSelect, onToggleFav, label }) {
  const longPress = useLongPress(onToggleFav)

  return (
    <button
      {...longPress}
      onClick={onSelect}
      className={`
        flex flex-col items-center gap-1 rounded-2xl p-3 transition-all relative select-none
        ${isSelected
          ? 'bg-primary-600 text-white shadow-blue scale-105'
          : 'bg-gray-50 hover:bg-gray-100 active:bg-gray-200 text-gray-700 border border-gray-100'
        }
      `}
    >
      {isFavorite && (
        <span className="absolute top-1.5 right-1.5 text-[10px] leading-none">⭐</span>
      )}
      <span className="text-2xl leading-none">{lang.flag}</span>
      <span className={`text-xs font-medium text-center leading-tight line-clamp-2 ${isSelected ? 'text-white' : 'text-gray-600'}`}>
        {label}
      </span>
      {isSelected && (
        <svg className="w-3.5 h-3.5 text-white" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  )
}

export default function LanguageSelect({ imagePreview, onConfirm, onBack }) {
  const { lang: appLang } = useAppLang()
  const t = UI[appLang] || UI.fr

  const [search, setSearch]                 = useState('')
  const [selectedTarget, setSelectedTarget] = useState(() => loadLastTarget())
  const [recentTargets, setRecentTargets]   = useState(() => loadList(RECENT_KEY))
  const [favorites, setFavorites]           = useState(() => loadList(FAV_KEY))

  // Image zoom modal
  const [modalOpen, setModalOpen] = useState(false)
  const [zoom, setZoom]           = useState(1)

  useEffect(() => { if (modalOpen) setZoom(1) }, [modalOpen])
  useEffect(() => {
    if (!modalOpen) return
    const h = (e) => { if (e.key === 'Escape') setModalOpen(false) }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
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
    setRecentTargets((prev) => {
      const updated = [lang, ...prev.filter((l) => l.code !== lang.code)].slice(0, MAX_RECENT)
      saveList(RECENT_KEY, updated)
      return updated
    })
  }

  const handleToggleFav = (lang) => {
    setFavorites((prev) => {
      const exists = prev.some((l) => l.code === lang.code)
      const updated = exists
        ? prev.filter((l) => l.code !== lang.code)
        : [lang, ...prev]
      saveList(FAV_KEY, updated)
      return updated
    })
  }

  const handleConfirm = () => {
    if (!selectedTarget) return
    onConfirm({ targetLang: selectedTarget })
  }

  const favSet    = new Set(favorites.map((l) => l.code))
  const showFavs  = !search && favorites.length > 0
  const showRecent = !search && recentTargets.filter(l => !favSet.has(l.code)).length > 0

  return (
    <>
      <div className="flex flex-col bg-white min-h-screen">

        {/* ── Sticky blue header ── */}
        <div
          className="flex items-center gap-3 px-4 sticky top-0 z-20"
          style={{
            background: 'var(--color-brand)',
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 10px)',
            paddingBottom: '10px',
          }}
        >
          <button
            onClick={onBack}
            className="w-9 h-9 rounded-full flex items-center justify-center bg-white/15 hover:bg-white/25 active:bg-white/35 transition-colors shrink-0"
            aria-label="Retour"
          >
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-white text-base leading-tight truncate">{t.title}</h2>
            <p className="text-white/60 text-xs">{t.step}</p>
          </div>
          {imagePreview && (
            <button
              onClick={() => setModalOpen(true)}
              className="rounded-xl border-2 border-white/30 overflow-hidden hover:opacity-80 active:opacity-60 transition-opacity shrink-0"
              aria-label="Agrandir"
            >
              <img src={imagePreview} alt="document" className="w-9 h-11 object-cover block" />
            </button>
          )}
        </div>

        <div className="px-4 pt-4 pb-36">


          {/* ── Favorites ── */}
          {showFavs && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
                ⭐ {t.favorites}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {favorites.map((lang) => (
                  <LangCard
                    key={lang.code}
                    lang={lang}
                    isSelected={selectedTarget?.code === lang.code}
                    isFavorite={true}
                    onSelect={() => handleSelectTarget(lang)}
                    onToggleFav={() => handleToggleFav(lang)}
                    label={langName(lang)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* ── Recent (non-favorite) ── */}
          {showRecent && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
                {t.recent}
              </p>
              <div className="flex gap-2 flex-wrap">
                {recentTargets.filter(l => !favSet.has(l.code)).map((lang) => {
                  const isSelected = selectedTarget?.code === lang.code
                  return (
                    <button
                      key={lang.code}
                      onClick={() => handleSelectTarget(lang)}
                      onContextMenu={(e) => { e.preventDefault(); handleToggleFav(lang) }}
                      className={`flex items-center gap-2 px-3 py-2 rounded-2xl border transition-all text-sm font-semibold ${
                        isSelected
                          ? 'bg-primary-600 text-white border-primary-600 shadow-blue'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span>{lang.flag}</span>
                      <span>{langName(lang)}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── All languages ── */}
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

            <div className="relative mb-4">
              <svg className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
                fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                inputMode="search"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder={t.search}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onInput={(e)  => setSearch(e.target.value)}
                className="w-full pl-10 pr-10 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
              />
              {search.length > 0 && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center rounded-full bg-gray-300 hover:bg-gray-400 transition-colors"
                  aria-label="Effacer"
                >
                  <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
                  </svg>
                </button>
              )}
            </div>

            <p className="text-xs text-gray-400 mb-3 text-center">Appui long sur une langue pour l'ajouter aux favoris ⭐</p>

            <div className="grid grid-cols-3 gap-2">
              {filteredLanguages.map((lang) => (
                <LangCard
                  key={lang.code}
                  lang={lang}
                  isSelected={selectedTarget?.code === lang.code}
                  isFavorite={favSet.has(lang.code)}
                  onSelect={() => handleSelectTarget(lang)}
                  onToggleFav={() => handleToggleFav(lang)}
                  label={langName(lang)}
                />
              ))}
              {filteredLanguages.length === 0 && (
                <div className="col-span-3 py-10 text-center text-gray-400 text-sm">
                  {t.noResult(search)}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Fixed bottom CTA ── */}
        <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 bg-white border-t border-gray-100 safe-bottom shadow-card-lg z-10">
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
            className={`w-full flex items-center justify-center gap-2.5 rounded-2xl py-4 text-base font-bold transition-all ${
              selectedTarget
                ? 'bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white shadow-blue'
                : 'bg-gray-100 text-gray-400 cursor-not-allowed'
            }`}
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
      {modalOpen && imagePreview && (
        <div className="fixed inset-0 z-50 bg-black flex flex-col"
          style={{ paddingTop: 'env(safe-area-inset-top, 0px)', paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          <div className="flex items-center justify-between px-4 py-3 shrink-0 bg-black/60 backdrop-blur-sm">
            <button onClick={() => setModalOpen(false)}
              className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center">
              <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12"/>
              </svg>
            </button>
            <div className="flex items-center gap-2">
              <button onClick={() => setZoom((z) => Math.max(z - 0.5, 0.5))} disabled={zoom <= 0.5}
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white text-xl disabled:opacity-30">−</button>
              <button onClick={() => setZoom(1)}
                className="px-3 py-1.5 rounded-xl bg-white/15 text-white text-xs font-semibold min-w-[3.5rem] text-center">
                {Math.round(zoom * 100)}%
              </button>
              <button onClick={() => setZoom((z) => Math.min(z + 0.5, 5))} disabled={zoom >= 5}
                className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center text-white text-xl disabled:opacity-30">+</button>
            </div>
            <button onClick={() => setZoom(1)} className="w-10 h-10 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5v-4m0 4h-4m4 0l-5-5"/>
              </svg>
            </button>
          </div>
          <div className="flex-1 overflow-auto" style={{ cursor: zoom > 1 ? 'grab' : 'default' }}>
            <div className="min-h-full flex items-center justify-center p-4"
              style={{ minWidth: zoom > 1 ? `${zoom * 100}%` : '100%' }}>
              <img src={imagePreview} alt="document" draggable={false}
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
