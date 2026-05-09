/**
 * Lightweight wrapper around the Web Notifications API.
 * Works whenever the tab is open (even in background).
 * No backend or Push API server required.
 */

const ICON = '/understand/icon.svg'

/**
 * Requests notification permission from the browser.
 * Must be called from a user gesture (tap / click).
 * @returns {Promise<boolean>} true if permission granted
 */
export async function requestNotifPermission() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  if (Notification.permission === 'denied') return false
  try {
    const result = await Notification.requestPermission()
    return result === 'granted'
  } catch {
    return false
  }
}

/**
 * Shows an OS-level notification if permission is already granted.
 * Silent no-op if notifications are unsupported or denied.
 *
 * @param {string} title
 * @param {string} body
 */
export function sendNotification(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  try {
    const n = new Notification(title, {
      body,
      icon:  ICON,
      badge: ICON,
      tag:   'understand-doc-ready',  // replace previous notification of same type
    })
    // Auto-close after 8 s
    setTimeout(() => n.close(), 8000)
  } catch (_) {}
}
