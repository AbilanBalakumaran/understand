/**
 * TTS — always-stream architecture.
 *
 * speak() is called synchronously from a click handler, so iOS Safari
 * never blocks playback. No generateAudio/Lingva pre-fetch, no async
 * barrier between the user gesture and audio.play().
 *
 * Chain: Google TTS <audio src=url> → Web Speech API (last resort)
 */

const MAX_CHUNK = 180

// ─── Chunk splitter ────────────────────────────────────────────────────────

export function splitIntoChunks(text) {
  if (text.length <= MAX_CHUNK) return [text]

  const sentences = text
    .replace(/([.!?।。！？])\s+/g, '$1\n')
    .split('\n')
    .map(s => s.trim())
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
          if (w.length <= MAX_CHUNK) { current = w }
          else { if (current) chunks.push(current); current = word }
        }
      }
    }
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [text.slice(0, MAX_CHUNK)]
}

// ─── Google TTS URL ────────────────────────────────────────────────────────
// Same endpoint as our translation API. <audio src=url> loads it without
// CORS restrictions — no fetch() needed, no blob, no object URL.

function googleTtsUrl(text, langBcp47) {
  const lang = langBcp47.split('-')[0]
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=gtx`
}

// ─── Shared state ─────────────────────────────────────────────────────────

let isActive = false
let currentAudio = null

// ─── Google TTS streaming ──────────────────────────────────────────────────
// Plays chunks sequentially via <audio src=googleTtsUrl>.
// Each chunk's playback triggers the next — stays within iOS audio policy.

function speakWithGoogleTts(text, lang, { rate = 1.0, onEnd, onError, onChunkStart } = {}) {
  const chunks = splitIntoChunks(text)
  let index = 0

  const playNext = () => {
    if (!isActive) return
    if (index >= chunks.length) { isActive = false; onEnd?.(); return }

    const chunkIndex = index
    const chunk = chunks[index++]
    onChunkStart?.(chunkIndex)

    const audio = new Audio(googleTtsUrl(chunk, lang))
    currentAudio = audio
    try { audio.playbackRate = Math.min(Math.max(rate, 0.5), 2) } catch (_) {}

    audio.addEventListener('ended', playNext, { once: true })
    audio.addEventListener('error', () => {
      if (!isActive) return
      // Google TTS failed (network issue) → try Web Speech for remaining text
      const remaining = chunks.slice(index - 1).join(' ')
      speakWithWebSpeech(remaining, lang, { rate, onEnd, onError,
        onChunkStart: i => onChunkStart?.(chunkIndex + i)
      })
    }, { once: true })

    audio.play().catch(() => {
      if (!isActive) return
      const remaining = chunks.slice(index - 1).join(' ')
      speakWithWebSpeech(remaining, lang, { rate, onEnd, onError,
        onChunkStart: i => onChunkStart?.(chunkIndex + i)
      })
    })
  }

  playNext()
}

// ─── Web Speech API (last-resort fallback) ────────────────────────────────

let currentUtterance = null

function getBestVoice(lang) {
  const voices = window.speechSynthesis.getVoices()
  if (!voices.length) return null
  const base = lang.split('-')[0].toLowerCase()
  return (
    voices.find(v => v.lang.toLowerCase() === lang.toLowerCase()) ||
    voices.find(v => v.lang.toLowerCase().startsWith(base)) ||
    null
  )
}

function speakWithWebSpeech(text, lang, { rate = 1.0, onEnd, onError, onChunkStart } = {}) {
  if (!('speechSynthesis' in window)) {
    onError?.(new Error('Synthèse vocale non supportée sur cet appareil.'))
    return
  }

  const chunks = splitIntoChunks(text)
  let index = 0
  let voice = null

  const doSpeak = () => {
    voice = getBestVoice(lang)
    const voices = window.speechSynthesis.getVoices()
    if (!voice && voices.length > 0) {
      isActive = false
      onError?.(new Error(`Voix "${lang.split('-')[0]}" non disponible. Vérifiez votre connexion.`))
      return
    }
    speakNext()
  }

  const speakNext = () => {
    if (!isActive) return
    if (index >= chunks.length) { isActive = false; onEnd?.(); return }
    const chunkIndex = index
    const utter = new SpeechSynthesisUtterance(chunks[index++])
    currentUtterance = utter
    onChunkStart?.(chunkIndex)
    utter.lang = lang
    utter.rate = Math.min(Math.max(rate, 0.5), 2)
    if (voice) utter.voice = voice
    utter.onend = speakNext
    utter.onerror = e => {
      if (e.error === 'canceled' || e.error === 'interrupted') return
      if (!isActive) return
      isActive = false
      onError?.(new Error(`Erreur audio (${e.error}). Réessayez.`))
    }
    window.speechSynthesis.speak(utter)
  }

  const voices = window.speechSynthesis.getVoices()
  if (voices.length === 0) {
    window.speechSynthesis.addEventListener('voiceschanged', doSpeak, { once: true })
    setTimeout(() => { if (isActive && index === 0) doSpeak() }, 1000)
  } else {
    doSpeak()
  }
}

// ─── Public API ────────────────────────────────────────────────────────────

export function stopSpeech() {
  isActive = false
  if (currentAudio) { currentAudio.pause(); currentAudio.src = ''; currentAudio = null }
  if ('speechSynthesis' in window) { window.speechSynthesis.cancel(); currentUtterance = null }
}

export function pauseSpeech() {
  currentAudio?.pause()
  if ('speechSynthesis' in window) window.speechSynthesis.pause()
}

export function resumeSpeech() {
  currentAudio?.play()
  if ('speechSynthesis' in window) window.speechSynthesis.resume()
}

/**
 * Streams text via Google TTS → Web Speech fallback.
 * Must be called synchronously from a user-gesture handler (click/tap)
 * so that iOS Safari allows audio.play() on the first chunk.
 */
export function speak(text, lang, { rate = 1.0, onEnd, onError, onChunkStart } = {}) {
  stopSpeech()
  isActive = true
  speakWithGoogleTts(text, lang, { rate, onEnd, onError, onChunkStart })
}
