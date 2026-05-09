/**
 * TTS via Web Speech API (native browser engine).
 * Falls back to Google Translate TTS if speechSynthesis is unavailable.
 *
 * Web Speech API works on all modern browsers (Chrome Android, iOS Safari,
 * Firefox, Edge) with no network request, no rate limits, and no CORS issues.
 * It is not blocked by GitHub Pages or mobile carrier NAT.
 */

const MAX_CHUNK = 180

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

// ─── Web Speech API ────────────────────────────────────────────────────────

let isActive = false
let currentUtterance = null

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

function speakWithWebSpeech(text, lang, { rate = 0.9, onEnd, onError } = {}) {
  const chunks = splitIntoChunks(text)
  let index = 0

  const speakNext = () => {
    if (!isActive) return
    if (index >= chunks.length) {
      isActive = false
      onEnd?.()
      return
    }

    const utter = new SpeechSynthesisUtterance(chunks[index++])
    currentUtterance = utter
    utter.lang = lang
    utter.rate = Math.min(Math.max(rate, 0.5), 2)

    const voice = getBestVoice(lang)
    if (voice) utter.voice = voice

    utter.onend = speakNext
    utter.onerror = (e) => {
      // 'canceled' and 'interrupted' are system-level events, not real errors
      if (e.error === 'canceled' || e.error === 'interrupted') return
      if (!isActive) return
      isActive = false
      onError?.(new Error(`Erreur de synthèse vocale : ${e.error}`))
    }

    window.speechSynthesis.speak(utter)
  }

  // iOS loads voices asynchronously — wait for them before starting
  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) {
    window.speechSynthesis.addEventListener('voiceschanged', speakNext, { once: true })
  } else {
    speakNext()
  }
}

// ─── Google TTS fallback ───────────────────────────────────────────────────

const GTTS_BASE = 'https://translate.google.com/translate_tts'

const LANG_OVERRIDE = {
  'fil-PH': 'tl',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'pt-BR': 'pt-BR',
}

function toGTTSLang(bcp47) {
  return LANG_OVERRIDE[bcp47] ?? bcp47.split('-')[0]
}

function buildGoogleUrl(text, lang) {
  return `${GTTS_BASE}?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${toGTTSLang(lang)}&client=tw-ob`
}

let currentAudio = null

function speakWithGoogleTTS(text, lang, { rate = 0.9, onEnd, onError } = {}) {
  const chunks = splitIntoChunks(text)
  let index = 0

  const playNext = () => {
    if (!isActive) return
    if (index >= chunks.length) {
      isActive = false
      onEnd?.()
      return
    }

    const chunk = chunks[index++]
    const audio = new Audio()
    currentAudio = audio
    audio.referrerPolicy = 'no-referrer'

    try {
      audio.playbackRate = Math.min(Math.max(rate, 0.5), 2)
    } catch (_) { /* not supported on all browsers */ }

    audio.addEventListener('ended', playNext, { once: true })
    audio.addEventListener('error', () => {
      if (!isActive) return
      isActive = false
      onError?.(new Error('Impossible de charger l\'audio. Vérifiez votre connexion internet.'))
    }, { once: true })

    audio.src = buildGoogleUrl(chunk, lang)
    audio.play().catch(() => {
      if (!isActive) return
      isActive = false
      onError?.(new Error('La lecture audio a été bloquée par le navigateur. Réessayez.'))
    })
  }

  playNext()
}

// ─── Public API ────────────────────────────────────────────────────────────

export function stopSpeech() {
  isActive = false
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    currentUtterance = null
  }
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
}

export function pauseSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.pause()
  } else {
    currentAudio?.pause()
  }
}

export function resumeSpeech() {
  if ('speechSynthesis' in window) {
    window.speechSynthesis.resume()
  } else {
    currentAudio?.play()
  }
}

export function isSpeaking() {
  return isActive
}

/**
 * Speak translated text in the given language.
 * Must be called from a user gesture (tap/click) for iOS compatibility.
 *
 * @param {string} text - translated text in target language
 * @param {string} lang - BCP-47 code e.g. 'fr-FR', 'es-ES'
 * @param {{ rate?: number, onEnd?: () => void, onError?: (e: Error) => void }} options
 */
export function speak(text, lang, { rate = 0.9, onEnd, onError } = {}) {
  stopSpeech()
  isActive = true

  if ('speechSynthesis' in window) {
    speakWithWebSpeech(text, lang, { rate, onEnd, onError })
  } else {
    speakWithGoogleTTS(text, lang, { rate, onEnd, onError })
  }
}
