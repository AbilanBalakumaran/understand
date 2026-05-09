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

export default function LanguageSelect({
  imagePreview,
  onConfirm,
  onBack,
  detectedLang,   // SOURCE_LANGUAGES object | null
  isDetecting,    // boolean
}) {
  const [search, setSearch]             = useState('')
  const [selectedTarget, setSelectedTarget] = useState(() => loadLastTarget())
  const [selectedSource, setSelectedSource] = useState(SOURCE_LANGUAGES[1]) // French default
  const [showSourcePicker, setShowSourcePicker] = useState(false)

  // Auto-select detected source language when detection finishes
  useEffect(() => {
    if (detectedLang && !isDetecting) {
      setSelectedSource(detectedLang)
    }
  }, [detectedLang, isDetecting])

  const filteredLanguages = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return TARGET_LANGUAGES
    return TARGET_LANGUAGES.filter(
      (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
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

      {/* ── Top bar ── */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 bg-gradient-to-b from-primary-50 to-white sticky top-0 z-10">
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
          <h2 className="font-bold text-gray-900 text-lg leading-tight">Choisissez votre langue</h2>
          <p className="text-gray-400 text-xs">Étape 2 / 3</p>
        </div>
        {imagePreview && (
          <img src={imagePreview} alt="document" className="ml-auto w-10 h-12 object-cover rounded-xl border border-gray-200" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-36">

        {/* ── Source language ── */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2.5">
            Langue du document
          </p>

          {/* Detection spinner */}
          {isDetecting && (
            <div className="flex items-center gap-3 bg-primary-50 rounded-2xl px-4 py-3.5 mb-2.5 border border-primary-100">
              <svg className="w-4 h-4 text-primary-500 spin-slow shrink-0" viewBox="0 0 24 24" fill="none">
                <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3"
                  strokeDasharray="31.4" strokeDashoffset="10" strokeLinecap="round"/>
              </svg>
              <p className="text-sm text-primary-700 font-medium">Détection de la langue en cours…</p>
            </div>
          )}

          {/* Auto-detected badge */}
          {detectedLang && !isDetecting && (
            <div className="flex items-center gap-2 mb-2.5 px-0.5">
              <span className="flex items-center gap-1.5 bg-green-50 text-green-700 text-xs font-semibold px-2.5 py-1 rounded-full border border-green-200">
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Auto-détecté
              </span>
              <p className="text-xs text-gray-400">Modifiable ci-dessous</p>
            </div>
          )}

          {/* Source selector */}
          <button
            onClick={() => setShowSourcePicker(!showSourcePicker)}
            className="flex items-center gap-3 w-full bg-gray-50 hover:bg-gray-100 active:bg-gray-200 rounded-2xl px-4 py-3.5 border border-gray-200 transition-colors"
          >
            <span className="text-xl">{selectedSource.flag}</span>
            <span className="text-gray-700 font-semibold text-sm flex-1 text-left">{selectedSource.name}</span>
            {detectedLang && selectedSource.code === detectedLang.code && !isDetecting && (
              <span className="text-xs text-primary-600 font-semibold bg-primary-50 px-2 py-0.5 rounded-full">Détecté</span>
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
                  <span className="text-sm text-gray-700 font-medium flex-1">{lang.name}</span>
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
              Votre langue — l'audio sera dans cette langue
            </p>
            {selectedTarget && (
              <span className="text-xs text-primary-600 font-semibold">
                {selectedTarget.flag} Mémorisée
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
              placeholder="Rechercher une langue…"
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
                    {lang.name}
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
                Aucune langue trouvée pour « {search} »
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Fixed bottom CTA ── */}
      <div className="fixed bottom-0 left-0 right-0 px-4 pb-6 pt-3 bg-white border-t border-gray-100 safe-bottom shadow-card-lg">
        {selectedTarget && (
          <div className="flex items-center gap-3 mb-3 bg-primary-50 rounded-2xl px-4 py-3 border border-primary-100">
            <span className="text-xl">{selectedTarget.flag}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-400">Langue sélectionnée</p>
              <p className="text-sm font-bold text-primary-700 truncate">{selectedTarget.name}</p>
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
          Créer l'audio
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
