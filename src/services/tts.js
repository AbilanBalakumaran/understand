/**
 * TTS via Google Translate (internet-based).
 * Works on all devices without any installation.
 * referrerPolicy='no-referrer' prevents GitHub Pages from being blocked by Google.
 */

const GTTS_BASE = 'https://translate.google.com/translate_tts'
const MAX_CHUNK = 180 // Google TTS hard limit ~200 chars

// BCP-47 → Google TTS language code
const LANG_OVERRIDE = {
  'fil-PH': 'tl',
  'zh-CN': 'zh-CN',
  'zh-TW': 'zh-TW',
  'pt-BR': 'pt-BR',
}

function toGTTSLang(bcp47) {
  return LANG_OVERRIDE[bcp47] ?? bcp47.split('-')[0]
}

function buildUrl(text, lang) {
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

let currentAudio = null
let isActive = false

export function stopSpeech() {
  isActive = false
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
}

export function pauseSpeech() {
  currentAudio?.pause()
}

export function resumeSpeech() {
  currentAudio?.play()
}

export function isSpeaking() {
  return isActive
}

/**
 * Speak translated text in the given language via Google TTS.
 * Must be called from a user gesture (tap/click) for iOS compatibility.
 *
 * @param {string} text - already-translated text in target language
 * @param {string} lang - BCP-47 code e.g. 'ta-IN', 'fr-FR'
 * @param {{ rate?: number, onEnd?: () => void, onError?: (e: Error) => void }} options
 */
export function speak(text, lang, { rate = 0.9, onEnd, onError } = {}) {
  stopSpeech()

  const chunks = splitIntoChunks(text)
  let index = 0
  isActive = true

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

    // Prevent GitHub Pages referer from being blocked by Google
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

    audio.src = buildUrl(chunk, lang)
    audio.play().catch(() => {
      if (!isActive) return
      isActive = false
      onError?.(new Error('La lecture audio a été bloquée par le navigateur. Réessayez.'))
    })
  }

  playNext()
}
