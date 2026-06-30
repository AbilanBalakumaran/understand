import { useState, useEffect } from 'react'
import { useAppLang } from '../context/AppLang'
import { isInstalled, canInstall, onPwaChange, promptInstall } from '../services/pwa'

const UI = {
  fr: {
    title:       'Paramètres',
    appLang:     "Langue de l'application",
    french:      'Français',
    english:     'English',
    close:       'Fermer',
    installTitle: "Installer l'application",
    installDesc:  "Accédez à Understand depuis votre écran d'accueil, sans navigateur.",
    installBtn:   "Installer",
    installed:    "Application installée ✓",
    installedSub: "Understand est déjà sur votre écran d'accueil.",
    howToTitle:   "Comment installer",
    iosSteps:    [
      "Appuyez sur le bouton Partager  en bas",
      "Faites défiler et appuyez sur « Sur l'écran d'accueil »",
      "Appuyez sur « Ajouter » en haut à droite",
    ],
    androidSteps: [
      "Appuyez sur le menu ⋮ en haut à droite",
      "Appuyez sur « Ajouter à l'écran d'accueil »",
      "Confirmez en appuyant sur « Installer »",
    ],
    desktopSteps: [
      "Cliquez sur l'icône  dans la barre d'adresse",
      "Ou cliquez sur le menu ⋮ → « Installer Understand »",
    ],
  },
  en: {
    title:       'Settings',
    appLang:     'App language',
    french:      'Français',
    english:     'English',
    close:       'Close',
    installTitle: 'Install the app',
    installDesc:  'Access Understand from your home screen, without a browser.',
    installBtn:   'Install',
    installed:    'App installed ✓',
    installedSub: 'Understand is already on your home screen.',
    howToTitle:   'How to install',
    iosSteps:    [
      'Tap the Share button  at the bottom',
      'Scroll and tap "Add to Home Screen"',
      'Tap "Add" in the top right',
    ],
    androidSteps: [
      'Tap the menu ⋮ in the top right',
      'Tap "Add to Home Screen"',
      'Confirm by tapping "Install"',
    ],
    desktopSteps: [
      'Click the  icon in the address bar',
      'Or click menu ⋮ → "Install Understand"',
    ],
  },
}

function getPlatform() {
  const ua = navigator.userAgent
  if (/iphone|ipad|ipod/i.test(ua)) return 'ios'
  if (/android/i.test(ua)) return 'android'
  return 'desktop'
}

export default function SettingsModal({ onClose }) {
  const { lang, setLang } = useAppLang()
  const t = UI[lang] || UI.fr

  const [pwaReady, setPwaReady] = useState(canInstall)
  const [pwaInstalled, setPwaInstalled] = useState(isInstalled)

  useEffect(() => {
    const unsub = onPwaChange(() => {
      setPwaReady(canInstall())
      setPwaInstalled(isInstalled())
    })
    return unsub
  }, [])

  const handleInstall = async () => {
    const ok = await promptInstall()
    if (ok) setPwaInstalled(true)
  }

  const platform = getPlatform()
  const manualSteps =
    platform === 'ios'     ? t.iosSteps :
    platform === 'android' ? t.androidSteps :
                             t.desktopSteps

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-end justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Sheet */}
      <div className="relative w-full max-w-md bg-white rounded-t-[28px] px-5 pt-5 shadow-2xl animate-slide-up overflow-y-auto max-h-[90vh]">
        {/* Handle */}
        <div className="w-10 h-1 bg-gray-200 rounded-full mx-auto mb-5" />

        <h2 className="text-xl font-bold text-gray-900 mb-6">{t.title}</h2>

        {/* ── Language selection ── */}
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

        {/* ── PWA Install ── */}
        <div className="mb-6">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3">
            {t.installTitle}
          </p>

          {pwaInstalled ? (
            /* Already installed */
            <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-2xl px-4 py-4">
              <div className="w-9 h-9 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/>
                </svg>
              </div>
              <div>
                <p className="font-bold text-green-700 text-sm">{t.installed}</p>
                <p className="text-green-600 text-xs mt-0.5">{t.installedSub}</p>
              </div>
            </div>

          ) : pwaReady ? (
            /* Browser install prompt available */
            <div className="bg-primary-50 border border-primary-100 rounded-2xl px-4 py-4">
              <div className="flex items-start gap-3 mb-4">
                <div className="w-10 h-10 rounded-2xl bg-primary-600 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
                    <path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16zm0-6h2v1.5H9V10z"/>
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-primary-800 text-sm">{t.installTitle}</p>
                  <p className="text-primary-600 text-xs mt-0.5 leading-relaxed">{t.installDesc}</p>
                </div>
              </div>
              <button
                onClick={handleInstall}
                className="w-full flex items-center justify-center gap-2 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white rounded-xl py-3 font-bold text-sm transition-colors shadow-blue"
              >
                <svg className="w-4 h-4 fill-white" viewBox="0 0 24 24">
                  <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                </svg>
                {t.installBtn}
              </button>
            </div>

          ) : (
            /* Manual instructions */
            <div className="bg-gray-50 border border-gray-200 rounded-2xl px-4 py-4">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 rounded-xl bg-primary-100 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 fill-primary-600" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                  </svg>
                </div>
                <p className="font-bold text-gray-700 text-sm">{t.howToTitle}</p>
              </div>
              <ol className="space-y-2.5">
                {manualSteps.map((step, i) => (
                  <li key={i} className="flex items-start gap-2.5">
                    <span className="w-5 h-5 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    <span className="text-gray-600 text-sm leading-relaxed">{step}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="w-full py-4 rounded-2xl bg-gray-100 text-gray-700 font-semibold text-sm hover:bg-gray-200 active:bg-gray-300 transition-colors"
        >
          {t.close}
        </button>

        <div style={{ height: 'max(env(safe-area-inset-bottom, 0px), 20px)' }} />
      </div>
    </div>
  )
}
