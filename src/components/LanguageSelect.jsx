import { useState, useMemo } from 'react'
import { TARGET_LANGUAGES, SOURCE_LANGUAGES } from '../data/languages'

export default function LanguageSelect({ imagePreview, onConfirm, onBack }) {
  const [search, setSearch] = useState('')
  const [selectedTarget, setSelectedTarget] = useState(null)
  const [selectedSource, setSelectedSource] = useState(SOURCE_LANGUAGES[0]) // default: English
  const [showSourcePicker, setShowSourcePicker] = useState(false)

  const filteredLanguages = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return TARGET_LANGUAGES
    return TARGET_LANGUAGES.filter(
      (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q)
    )
  }, [search])

  const handleConfirm = () => {
    if (!selectedTarget) return
    onConfirm({ sourceLang: selectedSource, targetLang: selectedTarget })
  }

  return (
    <div className="flex flex-col min-h-screen bg-white">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 pt-12 pb-4 bg-white sticky top-0 z-10 border-b border-gray-100">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label="Go back"
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 className="font-bold text-gray-900 text-lg leading-tight">Choose your language</h2>
          <p className="text-gray-400 text-xs">Step 2 of 3</p>
        </div>
        {/* Thumbnail */}
        {imagePreview && (
          <img src={imagePreview} alt="document" className="ml-auto w-10 h-12 object-cover rounded-lg border border-gray-200" />
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 pt-4 pb-32">
        {/* Document language (source) */}
        <div className="mb-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
            Document language (optional)
          </p>
          <button
            onClick={() => setShowSourcePicker(!showSourcePicker)}
            className="flex items-center gap-3 w-full bg-gray-50 hover:bg-gray-100 rounded-xl px-4 py-3 border border-gray-200 transition-colors"
          >
            <span className="text-xl">{selectedSource.flag}</span>
            <span className="text-gray-700 font-medium text-sm">{selectedSource.name}</span>
            <svg
              className={`w-4 h-4 text-gray-400 ml-auto transition-transform ${showSourcePicker ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {showSourcePicker && (
            <div className="mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {SOURCE_LANGUAGES.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => { setSelectedSource(lang); setShowSourcePicker(false) }}
                  className={`flex items-center gap-3 w-full px-4 py-3 hover:bg-gray-50 transition-colors text-left ${
                    selectedSource.code === lang.code ? 'bg-primary-50' : ''
                  }`}
                >
                  <span className="text-xl">{lang.flag}</span>
                  <span className="text-sm text-gray-700 font-medium">{lang.name}</span>
                  {selectedSource.code === lang.code && (
                    <svg className="w-4 h-4 text-primary-600 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Target language search */}
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
          Your language (audio will be in this language)
        </p>
        <div className="relative mb-4">
          <svg className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search language..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none"
          />
        </div>

        {/* Language grid */}
        <div className="grid grid-cols-3 gap-2 lang-grid">
          {filteredLanguages.map((lang) => {
            const isSelected = selectedTarget?.code === lang.code
            return (
              <button
                key={lang.code}
                onClick={() => setSelectedTarget(lang)}
                className={`
                  flex flex-col items-center gap-1.5 rounded-xl p-3 transition-all
                  ${isSelected
                    ? 'bg-primary-600 text-white shadow-lg shadow-blue-200 scale-105'
                    : 'bg-gray-50 hover:bg-gray-100 text-gray-700 border border-gray-100'
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
            <div className="col-span-3 py-8 text-center text-gray-400 text-sm">
              No language found for "{search}"
            </div>
          )}
        </div>
      </div>

      {/* Fixed bottom CTA */}
      <div className="fixed bottom-0 left-3 right-3 sm:left-0 sm:right-0 px-4 pb-6 pt-3 bg-white border border-gray-100 rounded-t-2xl safe-bottom shadow-lg">
        {selectedTarget && (
          <div className="flex items-center gap-2 mb-3 bg-primary-50 rounded-xl px-4 py-2.5">
            <span className="text-lg">{selectedTarget.flag}</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">Selected language</p>
              <p className="text-sm font-bold text-primary-700 truncate">{selectedTarget.name}</p>
            </div>
          </div>
        )}
        <button
          onClick={handleConfirm}
          disabled={!selectedTarget}
          className={`
            w-full flex items-center justify-center gap-2 rounded-2xl py-4 text-base font-bold transition-all
            ${selectedTarget
              ? 'bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white shadow-lg shadow-blue-200'
              : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }
          `}
        >
          <span>🎧</span>
          Create Audio
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
      </div>
    </div>
  )
}
