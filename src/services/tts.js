/**
 * TTS service: Uses Google Translate TTS (unofficial) as primary.
 * Falls back to Web Speech API if Google TTS is unavailable.
 */

const GTTS_BASE = 'https://translate.google.com/translate_tts'
const MAX_CHUNK = 180 // Google TTS max ~200 chars

// Language codes needing special handling for Google TTS
const LANG_OVERRIDE = {
  'fil-PH': 'tl',   // Tagalog
  'zh-CN': 'zh-CN', // Chinese Simplified
  'zh-TW': 'zh-TW', // Chinese Traditional
  'pt-BR': 'pt-BR', // Brazilian Portuguese
}

function toGTTSLang(bcp47) {
  return LANG_OVERRIDE[bcp47] ?? bcp47.split('-')[0]
}

function buildGTTSUrl(text, lang) {
  return `${GTTS_BASE}?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${toGTTSLang(lang)}&client=tw-ob`
}

function splitIntoChunks(text) {
  if (text.length <= MAX_CHUNK) return [text]

  const sentences = text
    .replace(/([.!?。！？])\s+/g, '$1\n')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)

  const chunks = []
  let current = ''

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence}` : sentence
    if (next.length <= MAX_CHUNK) {
      current = next
    } else {
      if (current) chunks.push(current)
      if (sentence.length <= MAX_CHUNK) {
        current = sentence
      } else {
        // Split long sentence by words
        current = ''
        for (const word of sentence.split(' ')) {
          const w = current ? `${current} ${word}` : word
          if (w.length <= MAX_CHUNK) {
            current = w
          } else {
            if (current) chunks.push(current)
            current = word
          }
        }
      }
    }
  }
  if (current) chunks.push(current)

  return chunks.length ? chunks : [text.slice(0, MAX_CHUNK)]
}

// --- State ---
let currentAudio = null
let isActivePlaying = false

export function stopSpeech() {
  isActivePlaying = false
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if ('speechSynthesis' in window) window.speechSynthesis.cancel()
}

export function pauseSpeech() {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause()
  } else if ('speechSynthesis' in window) {
    window.speechSynthesis.pause()
  }
}

export function resumeSpeech() {
  if (currentAudio?.paused && currentAudio.src) {
    currentAudio.play()
  } else if ('speechSynthesis' in window) {
    window.speechSynthesis.resume()
  }
}

export function isSpeaking() {
  return isActivePlaying || ('speechSynthesis' in window && window.speechSynthesis.speaking)
}

/**
 * Speak text in a given language using Google TTS.
 * @param {string} text
 * @param {string} lang - BCP-47 code e.g. 'fr-FR'
 * @param {object} options
 * @param {number} options.rate - playback rate 0.5–2 (default 0.9)
 * @param {() => void} options.onEnd
 * @param {(err: Error) => void} options.onError
 */
export function speak(text, lang, { rate = 0.9, onEnd, onError } = {}) {
  stopSpeech()

  const chunks = splitIntoChunks(text)
  let index = 0
  isActivePlaying = true

  const playNext = () => {
    if (!isActivePlaying) return
    if (index >= chunks.length) {
      isActivePlaying = false
      onEnd?.()
      return
    }

    const chunk = chunks[index++]
    const audio = new Audio()
    currentAudio = audio

    try {
      // Clamp playback rate to valid range
      audio.playbackRate = Math.min(Math.max(rate, 0.5), 2)
    } catch (_) { /* not supported on all browsers */ }

    const handleError = () => {
      if (!isActivePlaying) return
      // Fall back to Web Speech API for remaining text
      const remaining = chunks.slice(index - 1).join(' ')
      isActivePlaying = false
      speakFallback(remaining, lang, rate, onEnd, onError)
    }

    audio.addEventListener('ended', playNext, { once: true })
    audio.addEventListener('error', handleError, { once: true })

    audio.src = buildGTTSUrl(chunk, lang)
    audio.play().catch(handleError)
  }

  playNext()
}

// --- Web Speech API fallback ---

// Pre-load voices early
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.getVoices()
}

function getBestVoice(lang) {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const base = lang.split('-')[0].toLowerCase()
  return (
    voices.find((v) => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find((v) => v.lang.toLowerCase().startsWith(base)) ||
    null
  )
}

function speakFallback(text, lang, rate, onEnd, onError) {
  if (!('speechSynthesis' in window)) {
    onError?.(new Error('Text-to-speech is not supported in this browser.'))
    return
  }

  window.speechSynthesis.cancel()

  const doSpeak = () => {
    const sentences = text
      .replace(/([.!?])\s+/g, '$1\n')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)

    let i = 0
    const speakNext = () => {
      if (i >= sentences.length) { onEnd?.(); return }
      const utterance = new SpeechSynthesisUtterance(sentences[i++])
      utterance.lang = lang
      utterance.rate = rate
      utterance.pitch = 1
      const voice = getBestVoice(lang)
      if (voice) utterance.voice = voice
      utterance.onend = speakNext
      utterance.onerror = (e) => {
        if (e.error !== 'interrupted') onError?.(new Error(`Speech error: ${e.error}`))
      }
      window.speechSynthesis.speak(utterance)
    }
    speakNext()
  }

  if (window.speechSynthesis.getVoices().length) {
    doSpeak()
  } else {
    window.speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true })
  }
}
