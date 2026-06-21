import { useRef, useState, useCallback } from 'react'
import { convertPdfToImage, isPdf } from '../services/pdf'

function applyCanvasRotation(blobUrl, degrees) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const swapped = degrees === 90 || degrees === 270
      const canvas  = document.createElement('canvas')
      canvas.width  = swapped ? img.naturalHeight : img.naturalWidth
      canvas.height = swapped ? img.naturalWidth  : img.naturalHeight
      const ctx = canvas.getContext('2d')
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((degrees * Math.PI) / 180)
      ctx.drawImage(img, -img.naturalWidth / 2, -img.naturalHeight / 2)
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Canvas toBlob failed'))),
        'image/jpeg', 0.92,
      )
    }
    img.onerror = reject
    img.src     = blobUrl
  })
}

// ── Settings gear icon ────────────────────────────────────────────────────────
function GearIcon({ onClick }) {
  return (
    <button
      onClick={onClick}
      className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-white/20 active:bg-white/30 transition-colors"
      aria-label="Paramètres"
    >
      <svg className="w-5 h-5 fill-white" viewBox="0 0 24 24">
        <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
      </svg>
    </button>
  )
}

export default function UploadStep({ onImageSelected, onOpenSettings, appLang }) {
  const isFr = appLang === 'fr' || !appLang

  const fileInputRef   = useRef(null)
  const cameraInputRef = useRef(null)

  const [baseFile,    setBaseFile]    = useState(null)
  const [basePreview, setBasePreview] = useState(null)
  const [file,        setFile]        = useState(null)
  const [preview,     setPreview]     = useState(null)
  const [rotation,    setRotation]    = useState(0)

  const [isConvertingPdf, setIsConvertingPdf] = useState(false)
  const [isRotating,      setIsRotating]      = useState(false)
  const [pdfError,        setPdfError]        = useState(null)

  const handleFile = useCallback(async (f) => {
    if (!f) return
    setPdfError(null)

    if (isPdf(f)) {
      setIsConvertingPdf(true)
      try {
        const blob = await convertPdfToImage(f)
        const url  = URL.createObjectURL(blob)
        setBaseFile(blob);    setBasePreview(url)
        setFile(blob);        setPreview(url)
        setRotation(0)
      } catch {
        setPdfError(
          isFr
            ? 'Impossible de lire ce PDF. Essayez avec une image JPG/PNG.'
            : 'Cannot read this PDF. Try a JPG/PNG image.'
        )
      } finally {
        setIsConvertingPdf(false)
      }
      return
    }

    if (!f.type.startsWith('image/')) return

    const url = URL.createObjectURL(f)
    setBaseFile(f);    setBasePreview(url)
    setFile(f);        setPreview(url)
    setRotation(0)
  }, [isFr])

  const onFileChange = (e) => handleFile(e.target.files?.[0])

  const handleRotate = useCallback(async (delta) => {
    if (isRotating || !basePreview) return
    const newRot = (rotation + delta + 360) % 360
    setRotation(newRot)

    if (newRot === 0) {
      setFile(baseFile)
      setPreview(basePreview)
      return
    }

    setIsRotating(true)
    try {
      const rotatedBlob = await applyCanvasRotation(basePreview, newRot)
      const rotatedUrl  = URL.createObjectURL(rotatedBlob)
      setFile(rotatedBlob)
      setPreview(rotatedUrl)
    } catch (e) {
      console.error('Rotation failed', e)
    } finally {
      setIsRotating(false)
    }
  }, [rotation, basePreview, baseFile, isRotating])

  const handleConfirm = () => {
    if (!file || !preview || isRotating) return
    onImageSelected(file, preview)
  }

  const handleReset = () => {
    setBaseFile(null); setBasePreview(null)
    setFile(null);     setPreview(null)
    setRotation(0);    setPdfError(null)
  }

  const inputs = (
    <>
      <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} />
      <input ref={fileInputRef}   type="file" accept="image/*,application/pdf"        className="hidden" onChange={onFileChange} />
    </>
  )

  /* ══════════════════════════════════════════════════════
     STATE 1 — No image yet
  ══════════════════════════════════════════════════════ */
  if (!preview && !isConvertingPdf) {
    return (
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-primary-700 to-primary-500">
        {inputs}

        {/* Status-bar safe area + header */}
        <div
          className="flex items-center justify-between px-4 pb-3 bg-primary-700"
          style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
        >
          <span /> {/* spacer */}
          <GearIcon onClick={onOpenSettings} />
        </div>

        {/* Hero */}
        <div className="flex flex-col items-center pt-6 pb-8 px-6">
          <div className="w-16 h-16 bg-white/15 rounded-3xl flex items-center justify-center mb-5 backdrop-blur-sm">
            <svg viewBox="0 0 24 24" className="w-8 h-8 fill-white">
              <path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16zm0-6h2v1.5H9V10z"/>
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Understand</h1>
          <p className="text-white/65 text-center mt-2 text-sm leading-relaxed">
            {isFr
              ? 'Scannez un document · Traduisez-le · Écoutez-le'
              : 'Scan a document · Translate it · Listen to it'}
          </p>
        </div>

        {/* Card */}
        <div className="flex-1 bg-white rounded-t-[32px] px-5 pt-8 pb-10 flex flex-col gap-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest text-center mb-1">
            {isFr ? 'Étape 1 — Ajoutez votre document' : 'Step 1 — Add your document'}
          </p>

          {/* Camera */}
          <button
            onClick={() => cameraInputRef.current?.click()}
            className="flex items-center gap-4 w-full bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white rounded-2xl px-5 py-5 transition-colors shadow-blue"
          >
            <div className="w-11 h-11 rounded-xl bg-white/20 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 fill-white" viewBox="0 0 24 24">
                <path d="M20 5h-3.17L15 3H9L7.17 5H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm-8 13c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/>
              </svg>
            </div>
            <div className="text-left flex-1">
              <p className="font-bold text-base leading-tight">
                {isFr ? 'Prendre une photo' : 'Take a photo'}
              </p>
              <p className="text-white/60 text-sm mt-0.5">
                {isFr ? "Utiliser l'appareil photo" : 'Use the camera'}
              </p>
            </div>
            <svg className="w-5 h-5 text-white/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Gallery + PDF */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-4 w-full bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-800 rounded-2xl px-5 py-5 border-2 border-gray-100 transition-colors shadow-card"
          >
            <div className="w-11 h-11 rounded-xl bg-primary-50 flex items-center justify-center shrink-0">
              <svg className="w-6 h-6 fill-primary-600" viewBox="0 0 24 24">
                <path d="M21 19V5c0-1.1-.9-2-2-2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2zM8.5 13.5l2.5 3.01L14.5 12l4.5 6H5l3.5-4.5z"/>
              </svg>
            </div>
            <div className="text-left flex-1">
              <p className="font-bold text-base leading-tight">
                {isFr ? 'Choisir depuis la galerie' : 'Choose from gallery'}
              </p>
              <p className="text-gray-400 text-sm mt-0.5">
                {isFr ? 'Photo existante ou fichier PDF' : 'Existing photo or PDF file'}
              </p>
            </div>
            <svg className="w-5 h-5 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {pdfError && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-red-600 text-sm">
              {pdfError}
            </div>
          )}

          <div className="mt-2 bg-surface rounded-2xl px-4 py-4 flex gap-3 items-start border border-primary-100">
            <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-4 h-4 fill-primary-600" viewBox="0 0 24 24">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z"/>
              </svg>
            </div>
            <p className="text-gray-500 text-xs leading-relaxed">
              <span className="font-semibold text-gray-700">
                {isFr ? 'Formats acceptés :' : 'Accepted formats:'}
              </span>{' '}
              {isFr
                ? 'Photo (JPG, PNG) ou document PDF · Texte bien éclairé et lisible.'
                : 'Photo (JPG, PNG) or PDF document · Well-lit, readable text.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  /* ══════════════════════════════════════════════════════
     PDF LOADING
  ══════════════════════════════════════════════════════ */
  if (isConvertingPdf) {
    return (
      <div className="flex flex-col min-h-screen bg-gradient-to-b from-primary-700 to-primary-500 items-center justify-center gap-6 px-8">
        <div className="w-16 h-16 rounded-3xl bg-white/15 flex items-center justify-center">
          <svg className="w-8 h-8 fill-white spin-slow" viewBox="0 0 24 24">
            <path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/>
          </svg>
        </div>
        <div className="text-center">
          <p className="text-white font-bold text-lg">
            {isFr ? 'Conversion PDF…' : 'Converting PDF…'}
          </p>
          <p className="text-white/60 text-sm mt-1">
            {isFr ? 'Lecture de la première page' : 'Reading first page'}
          </p>
        </div>
      </div>
    )
  }

  /* ══════════════════════════════════════════════════════
     STATE 2 — Image selected
  ══════════════════════════════════════════════════════ */
  return (
    <div className="flex flex-col min-h-screen bg-white">
      {inputs}

      {/* Header opaque sticky */}
      <div
        className="flex items-center gap-3 px-4 pb-4 bg-white border-b border-gray-100 sticky top-0 z-10"
        style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
      >
        <button
          onClick={handleReset}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label={isFr ? 'Retour' : 'Back'}
        >
          <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div className="flex-1">
          <h2 className="font-bold text-gray-900 text-lg leading-tight">
            {isFr ? 'Votre document' : 'Your document'}
          </h2>
          <p className="text-gray-400 text-xs">{isFr ? 'Étape 1 / 3' : 'Step 1 / 3'}</p>
        </div>
        <button
          onClick={onOpenSettings}
          className="w-10 h-10 rounded-full flex items-center justify-center hover:bg-gray-100 active:bg-gray-200 transition-colors"
          aria-label={isFr ? 'Paramètres' : 'Settings'}
        >
          <svg className="w-5 h-5 fill-gray-500" viewBox="0 0 24 24">
            <path d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
          </svg>
        </button>
      </div>

      <div className="flex-1 px-4 pb-36 flex flex-col gap-4 pt-4">
        <div className="w-full aspect-square rounded-3xl overflow-hidden bg-gray-100 border border-gray-200 flex items-center justify-center">
          <img
            src={basePreview}
            alt="document"
            className="transition-transform duration-300"
            style={{
              transform:  `rotate(${rotation}deg)`,
              maxWidth:  (rotation === 90 || rotation === 270) ? '70%' : '100%',
              maxHeight: (rotation === 90 || rotation === 270) ? '70%' : '100%',
              objectFit: 'contain',
            }}
          />
        </div>

        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => handleRotate(-90)}
            disabled={isRotating}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 transition-colors text-gray-700 text-sm font-semibold disabled:opacity-40"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            <svg className="w-4 h-4 -scale-x-100" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9" />
            </svg>
            −90°
          </button>

          {rotation !== 0 && (
            <span className="text-xs text-primary-600 font-bold bg-primary-50 px-2 py-1 rounded-lg">
              {rotation}°
            </span>
          )}

          <button
            onClick={() => handleRotate(90)}
            disabled={isRotating}
            className="flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-gray-100 hover:bg-gray-200 active:bg-gray-300 transition-colors text-gray-700 text-sm font-semibold disabled:opacity-40"
          >
            +90°
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9" />
            </svg>
          </button>
        </div>

        <p className="text-center text-xs text-gray-400">
          {isFr ? 'Tournez si la photo est prise en paysage' : 'Rotate if the photo is in landscape'}
        </p>

        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-gray-200 text-gray-500 font-semibold text-sm hover:bg-gray-50 active:bg-gray-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          {isFr ? "Changer d'image ou de PDF" : 'Change image or PDF'}
        </button>
      </div>

      <div className="fixed bottom-0 left-0 right-0 px-4 pt-4 bg-white border-t border-gray-100 safe-bottom shadow-card-lg">
        <button
          onClick={handleConfirm}
          disabled={isRotating}
          className="w-full flex items-center justify-center gap-2.5 bg-primary-600 hover:bg-primary-700 active:bg-primary-800 disabled:opacity-60 text-white rounded-2xl py-4 font-bold text-base transition-colors shadow-blue"
        >
          {isRotating ? (
            <>
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" stroke="white" strokeWidth="3" strokeDasharray="31.4" strokeDashoffset="10"/>
              </svg>
              {isFr ? 'Rotation en cours…' : 'Rotating…'}
            </>
          ) : (
            <>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
              {isFr ? 'Utiliser cette image' : 'Use this image'}
            </>
          )}
        </button>
      </div>
    </div>
  )
}
