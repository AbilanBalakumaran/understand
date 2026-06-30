/**
 * PWA install helper — captures beforeinstallprompt as early as possible.
 * Import this in main.jsx before React mounts so the event is never missed.
 */

let deferredPrompt = null
let installed = typeof window !== 'undefined' &&
  window.matchMedia('(display-mode: standalone)').matches

const subscribers = new Set()
function notify() { subscribers.forEach(cb => cb()) }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferredPrompt = e
    notify()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferredPrompt = null
    notify()
  })
}

export const isInstalled = () => installed
export const canInstall  = () => !!deferredPrompt

/** Subscribe to install-state changes. Returns an unsubscribe function. */
export function onPwaChange(cb) {
  subscribers.add(cb)
  return () => subscribers.delete(cb)
}

/** Triggers the browser install prompt. Returns true if accepted. */
export async function promptInstall() {
  if (!deferredPrompt) return false
  deferredPrompt.prompt()
  const { outcome } = await deferredPrompt.userChoice
  if (outcome === 'accepted') { installed = true; deferredPrompt = null }
  notify()
  return outcome === 'accepted'
}
