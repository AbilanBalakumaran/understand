import { createContext, useContext, useState, useEffect } from 'react'

const AppLangContext = createContext(null)

export function AppLangProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('understand_appLang') || 'fr' } catch { return 'fr' }
  })

  useEffect(() => {
    try { localStorage.setItem('understand_appLang', lang) } catch {}
  }, [lang])

  return (
    <AppLangContext.Provider value={{ lang, setLang }}>
      {children}
    </AppLangContext.Provider>
  )
}

export function useAppLang() {
  return useContext(AppLangContext)
}
