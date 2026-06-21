import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// Auto-update: lorsqu'une nouvelle version est détectée, on recharge automatiquement
const updateSW = registerSW({
  onNeedRefresh() {
    // Nouvelle version disponible → activation immédiate sans demander à l'utilisateur
    updateSW(true)
  },
  onOfflineReady() {},
})

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
