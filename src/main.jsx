import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { AppLangProvider } from './context/AppLang.jsx'

// Reload the page whenever a new service worker takes control,
// so the user always runs the latest version immediately.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload()
  })
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppLangProvider>
      <App />
    </AppLangProvider>
  </React.StrictMode>
)
