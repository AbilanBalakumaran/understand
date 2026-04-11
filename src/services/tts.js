/**
 * TTS service using Web Speech API.
 * Must be called synchronously from a user gesture (button click) to work on iOS/Android.
 */

// Pre-load voices as early as possible
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.getVoices()
  window.speechSynthesis.addEventListener('voiceschanged', () => {}, { once: true })
}

let isRunning = false

/**
 * Find the best available voice for the given BCP-47 language code.
 * Returns null if no matching voice is installed on the device.
 */
export function getBestVoice(lang) {
  const voices = window.speechSynthesis?.getVoices() ?? []
  if (!voices.length) return null

  const base = lang.split('-')[0].toLowerCase()
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  )
}

/**
 * Returns true if a voice for the given language is installed on this device.
 */
export function hasVoiceFor(lang) {
  return getBestVoice(lang) !== null
}

export function stopSpeech() {
  isRunning = false
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

export function pauseSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.pause()
}

export function resumeSpeech() {
  if ('speechSynthesis' in window) window.speechSynthesis.resume()
}

export function isSpeaking() {
  return isRunning || ('speechSynthesis' in window && window.speechSynthesis.speaking)
}

/**
 * Speak text in a given language.
 * IMPORTANT: must be called synchronously from a user gesture (click/tap) to work on iOS/Android.
 *
 * @param {string} text
 * @param {string} lang - BCP-47 code e.g. 'fr-FR', 'ta-IN'
 * @param {object} options
 * @param {number} options.rate - playback rate 0.5–2 (default 0.9)
 * @param {() => void} options.onEnd
 * @param {(err: Error) => void} options.onError
 */
export function speak(text, lang, { rate = 0.9, onEnd, onError } = {}) {
  if (!('speechSynthesis' in window)) {
    onError?.(new Error('Text-to-speech is not supported in this browser.'))
    return
  }

  stopSpeech()
  isRunning = true

  // Split into sentences to avoid Chrome's long-text cutoff bug
  const sentences = text
    .replace(/([.!?。！？])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  // Find voice once — synchronous, no async needed by this point in the app flow
  const voice = getBestVoice(lang)

  let index = 0

  const speakNext = () => {
    if (!isRunning || index >= sentences.length) {
      if (isRunning) { isRunning = false; onEnd?.() }
      return
    }

    const utterance = new SpeechSynthesisUtterance(sentences[index++])
    utterance.lang = lang
    utterance.rate = rate
    utterance.pitch = 1
    if (voice) utterance.voice = voice

    utterance.onend = speakNext
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') {
        isRunning = false
        onError?.(new Error(`Speech error: ${e.error}`))
      }
    }

    window.speechSynthesis.speak(utterance)
  }

  speakNext()
}
