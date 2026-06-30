/**
 * TTS pipeline — two layers:
 *
 * 1. generateAudio (ready mode — seek bar + download)
 *    Pre-fetches all chunks from Lingva and merges into a single MP3 blob.
 *    Returns { blob, chunks } or null if Lingva is unavailable.
 *
 * 2. speak (streaming mode — always works, all languages)
 *    Google TTS <audio src=url> → Web Speech API fallback.
 *    Called synchronously from a click handler.
 *
 * iOS Safari fix: AudioContext.resume() is called synchronously from the click
 * handler before any await, unlocking audio for the whole page session.
 */

const MAX_CHUNK = 180
const ELEVENLABS_KEY  = import.meta.env.VITE_ELEVENLABS_API_KEY || null
const ELEVENLABS_VOICE = '21m00Tcm4TlvDq8ikWAM' // Rachel — multilingual

// ─── AbortSignal polyfill (Chrome 103+ / Safari 16+ / Android < 2022) ────

function abortAfter(ms) {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms)
  const ac = new AbortController()
  setTimeout(() => ac.abort(), ms)
  return ac.signal
}

// ─── iOS AudioContext unlock ───────────────────────────────────────────────
// Call this synchronously inside a click/tap handler to unlock iOS Safari's
// audio policy for the rest of the page session. After this, audio.play()
// works even from async contexts (after await).

export function unlockAudioContext() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    // Create and play a silent buffer (0 samples) — just to trigger the unlock
    const buf = ctx.createBuffer(1, 1, 22050)
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    src.start(0)
    ctx.resume().catch(() => {})
    // Close after a tick so it doesn't linger
    setTimeout(() => ctx.close().catch(() => {}), 500)
  } catch (_) {}
}

// ─── Chunk splitter ────────────────────────────────────────────────────────

export function splitIntoChunks(text) {
  if (text.length <= MAX_CHUNK) return [text]

  const sentences = text
    .replace(/([.!?।।؟۔])\s+/g, '$1\n')
    .replace(/([。！？])/g, '$1\n')
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
        const words = sentence.split(' ')
        if (words.length > 1) {
          for (const word of words) {
            const w = current ? `${current} ${word}` : word
            if (w.length <= MAX_CHUNK) { current = w }
            else { if (current) chunks.push(current); current = word }
          }
        } else {
          for (let i = 0; i < sentence.length; i += MAX_CHUNK) {
            chunks.push(sentence.slice(i, i + MAX_CHUNK))
          }
          current = ''
        }
      }
    }
  }
  if (current) chunks.push(current)
  return chunks.length ? chunks : [text.slice(0, MAX_CHUNK)]
}

// ─── Lingva TTS (blob fetch — for seek bar + download) ────────────────────

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

// ─── Google TTS URL ────────────────────────────────────────────────────────

function googleTtsUrl(text, langBcp47) {
  const lang = langBcp47.split('-')[0]
  return `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=gtx`
}

// ─── Shared streaming state ────────────────────────────────────────────────

let isActive = false
let currentAudio = null
let objectUrls = []

function cleanupUrls() {
  objectUrls.forEach(u => { try { URL.revokeObjectURL(u) } catch (_) {} })
  objectUrls = []
}

// ─── Google TTS streaming ──────────────────────────────────────────────────

function speakWithGoogleTts(text, lang, { rate = 1.0, onEnd, onError, onChunkStart } = {}) {
  const chunks = splitIntoChunks(text)
  let index = 0

  const playNext = () => {
    if (!isActive) { cleanupUrls(); return }
    if (index >= chunks.length) { isActive = false; cleanupUrls(); onEnd?.(); return }

    const chunkIndex = index
    const chunk = chunks[index++]
    onChunkStart?.(chunkIndex)

    const audio = new Audio(googleTtsUrl(chunk, lang))
    currentAudio = audio
    try { audio.playbackRate = Math.min(Math.max(rate, 0.5), 2) } catch (_) {}

    audio.addEventListener('ended', playNext, { once: true })
    audio.addEventListener('error', () => {
      if (!isActive) return
      const remaining = chunks.slice(index - 1).join(' ')
      speakWithWebSpeech(remaining, lang, { rate, onEnd, onError,
        onChunkStart: i => onChunkStart?.(chunkIndex + i) })
    }, { once: true })

    audio.play().catch(() => {
      if (!isActive) return
      const remaining = chunks.slice(index - 1).join(' ')
      speakWithWebSpeech(remaining, lang, { rate, onEnd, onError,
        onChunkStart: i => onChunkStart?.(chunkIndex + i) })
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
  cleanupUrls()
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
 * Streams text via Google TTS (synchronous — safe for iOS Safari click handler).
 */
export function speak(text, lang, { rate = 1.0, onEnd, onError, onChunkStart } = {}) {
  stopSpeech()
  isActive = true
  speakWithGoogleTts(text, lang, { rate, onEnd, onError, onChunkStart })
}

/**
 * Pre-fetches audio for the full text → single blob (enables seek bar + download).
 *
 * Priority:
 *   1. ElevenLabs direct (if VITE_ELEVENLABS_API_KEY set) — best voice quality
 *   2. Worker /tts (ElevenLabs → Gemini TTS → Google Cloud TTS)
 *   3. Lingva TTS (fallback)
 * Returns { blob, chunks } or null → caller falls back to streaming.
 */
export async function generateAudio(text, lang, { onProgress, signal } = {}) {
  // ── 1. ElevenLabs direct ──────────────────────────────────────────────
  if (ELEVENLABS_KEY) {
    try {
      if (signal?.aborted) return null
      onProgress?.(5)
      const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + ELEVENLABS_VOICE, {
        method: 'POST',
        headers: { 'xi-api-key': ELEVENLABS_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: abortAfter(30000),
      })
      if (signal?.aborted) return null
      if (r.ok) {
        const mp3 = await r.blob()
        if (mp3.size > 100) {
          onProgress?.(100)
          return { blob: mp3, chunks: splitIntoChunks(text) }
        }
      }
    } catch (_) {}
  }

  // ── 2. Try Worker /tts (ElevenLabs server-side → Gemini TTS) ─────────
  try {
    const { generateAudioWithGemini, isGeminiAvailable } = await import('./gemini-ocr')
    if (isGeminiAvailable()) {
      if (signal?.aborted) return null
      onProgress?.(5)
      const wavBlob = await generateAudioWithGemini(text, lang.split('-')[0])
      if (signal?.aborted) return null
      if (wavBlob && wavBlob.size > 100) {
        onProgress?.(100)
        return { blob: wavBlob, chunks: splitIntoChunks(text) }
      }
    }
  } catch (e) {
    if (!e.message?.includes('GEMINI_UNAVAILABLE') && !e.message?.includes('GEMINI_KEY_MISSING')) {
      console.warn('[tts] Worker TTS error:', e.message)
    }
  }

  // ── 2. Lingva TTS fallback ─────────────────────────────────────────────
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
