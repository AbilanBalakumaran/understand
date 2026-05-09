/**
 * TTS entièrement via internet (Lingva Translate → Google TTS côté serveur).
 * Supporte Tamil, Hindi, Arabe et toutes les langues sans voix installée sur l'appareil.
 * Fallback : Web Speech API si Lingva est indisponible.
 */

const MAX_CHUNK = 180

const LINGVA_INSTANCES = [
  'https://lingva.ml',
  'https://translate.plausibility.cloud',
]

export function splitIntoChunks(text) {
  if (text.length <= MAX_CHUNK) return [text]

  const sentences = text
    .replace(/([.!?।。！？])\s+/g, '$1\n')
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

// ─── Lingva TTS ────────────────────────────────────────────────────────────

let isActive = false
let currentAudio = null
let objectUrls = []

function cleanupUrls() {
  objectUrls.forEach((u) => { try { URL.revokeObjectURL(u) } catch (_) {} })
  objectUrls = []
}

async function fetchLingvaAudio(text, langBcp47) {
  const lang = langBcp47.split('-')[0]
  for (const instance of LINGVA_INSTANCES) {
    try {
      const url = `${instance}/api/v1/audio/${lang}/${encodeURIComponent(text)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!res.ok) continue
      const data = await res.json()
      if (!Array.isArray(data.audio) || !data.audio.length) continue
      const bytes = new Uint8Array(data.audio)
      const blob = new Blob([bytes], { type: 'audio/mpeg' })
      const objectUrl = URL.createObjectURL(blob)
      objectUrls.push(objectUrl)
      return objectUrl
    } catch (_) {}
  }
  return null
}

function speakWithLingva(text, lang, { rate = 0.9, onEnd, onError, onChunkStart } = {}) {
  const chunks = splitIntoChunks(text)
  let index = 0

  const playNext = async () => {
    if (!isActive) { cleanupUrls(); return }
    if (index >= chunks.length) {
      isActive = false
      cleanupUrls()
      onEnd?.()
      return
    }

    const chunkIndex = index
    const chunk = chunks[index++]
    onChunkStart?.(chunkIndex)         // ← notifie quel chunk est en cours

    const audioUrl = await fetchLingvaAudio(chunk, lang)

    if (!audioUrl) {
      speakWithWebSpeech(text, lang, { rate, onEnd, onError, onChunkStart })
      return
    }

    const audio = new Audio(audioUrl)
    currentAudio = audio
    try { audio.playbackRate = Math.min(Math.max(rate, 0.5), 2) } catch (_) {}

    audio.addEventListener('ended', () => playNext(), { once: true })
    audio.addEventListener('error', () => {
      if (!isActive) return
      isActive = false
      cleanupUrls()
      onError?.(new Error('Impossible de lire l\'audio. Vérifiez votre connexion internet.'))
    }, { once: true })

    audio.play().catch(() => {
      if (!isActive) return
      isActive = false
      cleanupUrls()
      onError?.(new Error('Lecture audio bloquée par le navigateur. Appuyez à nouveau sur Play.'))
    })
  }

  playNext()
}

// ─── Web Speech API (fallback) ─────────────────────────────────────────────

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

function speakWithWebSpeech(text, lang, { rate = 0.9, onEnd, onError, onChunkStart } = {}) {
  if (!('speechSynthesis' in window)) {
    onError?.(new Error('Synthèse vocale non supportée. Vérifiez votre connexion internet.'))
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
        `Voix "${lang.split('-')[0]}" non installée et Lingva indisponible.\n` +
        `Réessayez dans quelques instants.`
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
    onChunkStart?.(chunkIndex)         // ← notifie quel chunk est en cours
    utter.lang = lang
    utter.rate = Math.min(Math.max(rate, 0.5), 2)
    if (voice) utter.voice = voice

    utter.onend = speakNext
    utter.onerror = (e) => {
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

// ─── API publique ──────────────────────────────────────────────────────────

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
 * Lit le texte traduit dans la langue cible via internet (Lingva TTS).
 * Doit être appelé depuis un geste utilisateur (tap/click) pour iOS.
 *
 * @param {string} text
 * @param {string} lang - BCP-47 ex: 'ta-IN', 'fr-FR'
 * @param {{ rate?, onEnd?, onError?, onChunkStart? }} options
 *   onChunkStart(index) appelé au début de chaque chunk lu
 */
export function speak(text, lang, { rate = 0.9, onEnd, onError, onChunkStart } = {}) {
  stopSpeech()
  isActive = true
  speakWithLingva(text, lang, { rate, onEnd, onError, onChunkStart })
}
