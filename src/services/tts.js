/**
 * TTS pipeline — two layers:
 *
 * 1. generateAudio  (ready mode, seek bar)
 *    Fetches all chunks from Lingva and merges them into a single MP3 blob.
 *    If any Lingva instance fails → returns null (caller falls back to streaming).
 *
 * 2. speak  (streaming mode — always works)
 *    Uses Google TTS URLs directly via <audio> elements.
 *    No CORS issue: <audio src> loads cross-origin without restrictions.
 *    Supports ALL languages (same backend as our translation API).
 *    Fallback: Web Speech API if audio element fails to load.
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

// ─── AbortSignal polyfill ─────────────────────────────────────────────────
// AbortSignal.timeout is Chrome 103+ / Firefox 100+ / Safari 16+.
// Older Android devices fall back to manual abort.

function abortAfter(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), ms)
  return ac.signal
}

// ─── Google TTS URL (direct, no API key, all languages) ───────────────────
// Same endpoint pattern as our translation API. <audio src=url> loads it
// without CORS restrictions — no fetch() needed.

function googleTtsUrl(text, langBcp47) {
  const lang = langBcp47.split('-')[0]
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=gtx`
}

// ─── Lingva TTS (blob fetch — only used for generateAudio seek bar) ───────

const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
]

async function fetchLingvaBlob(text, langBcp47) {
  const lang = langBcp47.split('-')[0]
  for (const instance of LINGVA_INSTANCES) {
    try {
      const url = `${instance}/api/v1/audio/${lang}/${encodeURIComponent(text)}`
      const res = await fetch(url, { signal: abortAfter(10000) })
      if (!res.ok) continue
      const data = await res.json()
      if (!Array.isArray(data.audio) || !data.audio.length) continue
      return new Blob([new Uint8Array(data.audio)], { type: 'audio/mpeg' })
    } catch (_) {}
  }
  return null
}

// ─── Shared state ─────────────────────────────────────────────────────────

let isActive = false
let currentAudio = null
let objectUrls = []

function cleanupUrls() {
  objectUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch (_) {} })
  objectUrls = []
}

// ─── Google TTS streaming (speak mode) ────────────────────────────────────
// Plays chunks sequentially via <audio src=googleTtsUrl>.
// Falls back to Web Speech API only if the audio element itself errors.

function speakWithGoogleTts(text, lang, { rate = 1.0, onEnd, onError, onChunkStart } = {}) {
  const chunks = splitIntoChunks(text)
  let index = 0

  const playNext = () => {
    if (!isActive) { cleanupUrls(); return }
    if (index >= chunks.length) {
      isActive = false
      cleanupUrls()
      onEnd?.()
      return
    }

    const chunkIndex = index
    const chunk = chunks[index++]
    onChunkStart?.(chunkIndex)

    const audio = new Audio(googleTtsUrl(chunk, lang))
    currentAudio = audio
    try { audio.playbackRate = Math.min(Math.max(rate, 0.5), 2) } catch (_) {}

    audio.addEventListener('ended', () => playNext(), { once: true })

    audio.addEventListener('error', () => {
      if (!isActive) return
      // Google TTS failed (network, CORS quirk, etc.) — try Web Speech
      speakWithWebSpeech(text, lang, { rate, onEnd, onError, onChunkStart })
    }, { once: true })

    audio.play().catch(() => {
      if (!isActive) return
      speakWithWebSpeech(text, lang, { rate, onEnd, onError, onChunkStart })
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
      onError?.(new Error(
        `Voix "${lang.split('-')[0]}" non disponible sur cet appareil.\n` +
        `Vérifiez votre connexion internet et réessayez.`
      ))
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
  cleanupUrls()
  if (currentAudio) {
    currentAudio.pause()
    currentAudio.src = ''
    currentAudio = null
  }
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel()
    currentUtterance = null
  }
}

export function pauseSpeech() {
  currentAudio?.pause()
  if ('speechSynthesis' in window) window.speechSynthesis.pause()
}

export function resumeSpeech() {
  currentAudio?.play()
  if ('speechSynthesis' in window) window.speechSynthesis.resume()
}

export function isSpeaking() {
  return isActive
}

/**
 * Streams the translated text via Google TTS (always works, all languages).
 * Falls back to Web Speech API only if the audio element itself errors.
 */
export function speak(text, lang, { rate = 1.0, onEnd, onError, onChunkStart } = {}) {
  stopSpeech()
  isActive = true
  speakWithGoogleTts(text, lang, { rate, onEnd, onError, onChunkStart })
}

/**
 * Pre-fetches all chunks from Lingva → single MP3 blob (enables seek bar).
 * Returns { blob, chunks } or null if Lingva is unavailable.
 * Caller falls back to speak() (streaming via Google TTS) when null.
 */
export async function generateAudio(text, lang, { onProgress, signal } = {}) {
  const chunks = splitIntoChunks(text)
  const blobs  = []

  for (let i = 0; i < chunks.length; i++) {
    if (signal?.aborted) return null
    const blob = await fetchLingvaBlob(chunks[i], lang)
    if (signal?.aborted) return null
    if (!blob) return null
    blobs.push(blob)
    onProgress?.(Math.round(((i + 1) / chunks.length) * 100))
  }

  return { blob: new Blob(blobs, { type: 'audio/mpeg' }), chunks }
}
