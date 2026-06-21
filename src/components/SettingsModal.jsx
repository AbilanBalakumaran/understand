import { useAppLang } from '../context/AppLang'

const UI = {
  fr: {
    title:    'Paramètres',
    appLang:  "Langue de l'application",
    french:   'Français',
    english:  'English',
    close:    'Fermer',
  },
  en: {
    title:    'Settings',
    appLang:  'App language',
    french:   'Français',
    english:  'English',
    close:    'Close',
  },
}

export default function SettingsModal({ onClose }) {
  const { lang, setLang } = useAppLang()
  const t = UI[lang] || UI.fr

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-md bg-white rounded-t-[28px] px-5 pt-5 pb-safe-bottom shadow-2xl animate-slide-up">
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

        <h2 className="text-xl font-bold text-gray-900 mb-6">{t.title}</h2>

        {/* Language selection */}
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
          {t.appLang}
        </p>
        <div className="flex gap-3 mb-8">
          <button
            onClick={() => setLang('fr')}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm border-2 transition-all ${
              lang === 'fr'
                ? 'bg-primary-600 border-primary-600 text-white shadow-blue'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            🇫🇷 {t.french}
          </button>
          <button
            onClick={() => setLang('en')}
            className={`flex-1 flex items-center justify-center gap-2 py-3.5 rounded-2xl font-semibold text-sm border-2 transition-all ${
              lang === 'en'
                ? 'bg-primary-600 border-primary-600 text-white shadow-blue'
                : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
            }`}
          >
            🇬🇧 {t.english}
          </button>
        </div>

        <button
          onClick={onClose}
          className="w-full py-4 rounded-2xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 active:bg-gray-300 transition-colors"
        >
          {t.close}
        </button>

        {/* iOS home indicator spacing */}
        <div style={{ height: 'max(env(safe-area-inset-bottom, 0px), 20px)' }} />
      </div>
    </div>
  )
}
