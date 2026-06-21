import { useState, useMemo, useEffect } from 'react'
import { TARGET_LANGUAGES, SOURCE_LANGUAGES } from '../data/languages'

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

// Returns the display name for a language object depending on app language
function langName(lang, appLang) {
  return (appLang === 'fr' && lang.nameFr) ? lang.nameFr : lang.name
}

export default function LanguageSelect({
  appLang,
  imagePreview,
  onConfirm,
  onBack,
  detectedLang,
  isDetecting,
  onOpenSettings,
}) {
  const isFr = appLang === 'fr' || !appLang

  const [search, setSearch]               = useState('')
  const [selectedTarget, setSelectedTarget] = useState(() => loadLastTarget())
  const [selectedSource, setSelectedSource] = useState(SOURCE_LANGUAGES[1]) // Français par défaut
  const [showSourcePicker, setShowSourcePicker] = useState(false)

  useEffect(() => {
    if (detectedLang && !isDetecting) {
      setSelectedSource(detectedLang)
    }
  }, [detectedLang, isDetecting])

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
    <div className="flex flex-col min-h-screen bg-white">

      {/* ── Header opaque sticky ── */}
      <div
        className="flex items-center gap-3 px-4 pb-4 bg-white border-b border-gray-100 sticky top-0 z-10"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
      >
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label={isFr ? 'Retour' : 'Back'}
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="font-bold text-gray-900 text-lg leading-tight">
            {isFr ? 'Choisissez votre langue' : 'Choose your language'}
          </h2>
          <p className="text-gray-400 text-xs">{isFr ? 'Étape 2 / 3' : 'Step 2 / 3'}</p>
        </div>
        {imagePreview && (
          <img src={imagePreview} alt="document" className="w-10 h-12 object-cover rounded-xl border border-gray-200" />
        )}
        <button
          onClick={onOpenSettings}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label={isFr ? 'Paramètres' : 'Settings'}
        >
          <svg className="w-5 h-5 fill-gray-500" viewBox="0 0 24 24">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-36">

        {/* ── Source language ── */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
            {isFr ? 'Langue du document' : 'Document language'}
          </p>

          {isDetecting && (
            <div className="flex items-center gap-3 bg-primary-50 rounded-2xl px-4 py-3.5 mb-2.5 border border-primary-100">
              <svg className="w-4 h-4 text-primary-500 spin-slow shrink-0" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                  strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
              </svg>
              <p className="text-sm text-primary-700 font-medium">
                {isFr ? 'Détection de la langue en cours…' : 'Detecting language…'}
              </p>
            </div>
          )}

          {detectedLang && !isDetecting && (
            <div className="flex items-center gap-2 mb-2.5 px-0.5">
              <span className="flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                {isFr ? 'Auto-détecté' : 'Auto-detected'}
              </span>
              <p className="text-xs text-gray-400">
                {isFr ? 'Modifiable ci-dessous' : 'You can change it below'}
              </p>
            </div>
          )}

          <button
            onClick={() => setShowSourcePicker(!showSourcePicker)}
            className="flex items-center gap-3 w-full bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-2xl px-4 py-3.5 border border-gray-200 transition-colors"
          >
            <span className="text-xl">{selectedSource.flag}</span>
            <span className="text-gray-700 font-semibold text-sm flex-1 text-left">
              {langName(selectedSource, appLang)}
            </span>
            {detectedLang && selectedSource.code === detectedLang.code && !isDetecting && (
              <span className="text-xs text-primary-600 font-semibold bg-primary-50 px-2 py-0.5 rounded-full">
                {isFr ? 'Détecté' : 'Detected'}
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
                  <span className="text-sm text-gray-700 font-medium flex-1">
                    {langName(lang, appLang)}
                  </span>
                  {lang.code === detectedLang?.code && (
                    <span className="text-xs text-green-600 font-semibold mr-1">Auto</span>
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
              {isFr ? "Votre langue — l'audio sera dans cette langue" : 'Your language — audio will be in this language'}
            </p>
            {selectedTarget && (
              <span className="text-xs text-primary-600 font-semibold shrink-0 ml-2">
                {selectedTarget.flag} {isFr ? 'Mémorisée' : 'Saved'}
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
              placeholder={isFr ? 'Rechercher une langue…' : 'Search a language…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-3.5 bg-gray-50 border border-gray-200 rounded-2xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
            />
          </div>

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
                    {langName(lang, appLang)}
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
                {isFr ? `Aucune langue trouvée pour « ${search} »` : `No language found for "${search}"`}
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
              <p className="text-xs text-gray-400">
                {isFr ? 'Langue sélectionnée' : 'Selected language'}
              </p>
              <p className="text-sm font-bold text-primary-700 truncate">
                {langName(selectedTarget, appLang)}
              </p>
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
          {isFr ? "Créer l'audio" : 'Create audio'}
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
