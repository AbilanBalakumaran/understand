let currentUtterance = null

/**
 * Get the best available voice for a language.
 */
function getBestVoice(lang) {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null

  const base = lang.split('-')[0].toLowerCase()

  // Prefer exact match
  let voice = voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase())
  // Then language prefix match
  if (!voice) voice = voices.find((v) => v.lang.toLowerCase().startsWith(base))
  // Then any match
  if (!voice) voice = voices.find((v) => v.lang.toLowerCase().includes(base))

  return voice || null
}

/**
 * Stop any current speech.
 */
export function stopSpeech() {
  window.speechSynthesis.cancel()
  currentUtterance = null
}

/**
 * Speak text in a given language.
 * @param {string} text
 * @param {string} lang - BCP-47 code e.g. 'fr-FR'
 * @param {object} options
 * @param {number} options.rate - playback rate 0.5–2 (default 0.9)
 * @param {() => void} options.onEnd
 * @param {(err: Error) => void} options.onError
 */
export function speak(text, lang, { rate = 0.9, onEnd, onError } = {}) {
  if (!('speechSynthesis' in window)) {
    onError?.(new Error('Text-to-speech is not supported in this browser.'))
    return null
  }

  stopSpeech()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = lang
  utterance.rate = rate
  utterance.pitch = 1

  // Assign voice after voices are loaded
  const assignVoice = () => {
    const voice = getBestVoice(lang)
    if (voice) utterance.voice = voice
  }

  if (window.speechSynthesis.getVoices().length) {
    assignVoice()
  } else {
    window.speechSynthesis.addEventListener('voiceschanged', assignVoice, { once: true })
  }

  utterance.onend = () => {
    currentUtterance = null
    onEnd?.()
  }
  utterance.onerror = (e) => {
    currentUtterance = null
    if (e.error !== 'interrupted') {
      onError?.(new Error(`Speech error: ${e.error}`))
    }
  }

  // Chrome bug: long utterances get cut off — split into sentences
  const sentences = splitIntoSentences(text)
  if (sentences.length > 1) {
    speakSentences(sentences, lang, rate, onEnd, onError)
    return
  }

  currentUtterance = utterance
  window.speechSynthesis.speak(utterance)
}

/**
 * Split text into sentences for Chrome TTS workaround.
 */
function splitIntoSentences(text) {
  return text
    .replace(/([.!?])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Speak sentences sequentially (Chrome long text workaround).
 */
function speakSentences(sentences, lang, rate, onEnd, onError) {
  let index = 0

  const speakNext = () => {
    if (index >= sentences.length) {
      onEnd?.()
      return
    }
    const utterance = new SpeechSynthesisUtterance(sentences[index])
    utterance.lang = lang
    utterance.rate = rate
    utterance.pitch = 1

    const voice = getBestVoice(lang)
    if (voice) utterance.voice = voice

    utterance.onend = () => {
      index++
      speakNext()
    }
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted') {
        onError?.(new Error(`Speech error: ${e.error}`))
      }
    }

    currentUtterance = utterance
    window.speechSynthesis.speak(utterance)
  }

  speakNext()
}

/**
 * Pause speech.
 */
export function pauseSpeech() {
  window.speechSynthesis.pause()
}

/**
 * Resume speech.
 */
export function resumeSpeech() {
  window.speechSynthesis.resume()
}

/**
 * Check if speech synthesis is speaking.
 */
export function isSpeaking() {
  return window.speechSynthesis.speaking
}
