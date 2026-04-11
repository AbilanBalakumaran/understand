import { useRef, useState, useCallback } from 'react'

export default function UploadStep({ onImageSelected }) {
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const [preview, setPreview] = useState(null)
  const [dragging, setDragging] = useState(false)

  const handleFile = useCallback((file) => {
    if (!file || !file.type.startsWith('image/')) return
    const url = URL.createObjectURL(file)
    setPreview(url)
    onImageSelected(file, url)
  }, [onImageSelected])

  const onFileChange = (e) => handleFile(e.target.files?.[0])

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    handleFile(e.dataTransfer.files?.[0])
  }

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-primary-600 to-primary-800">
      {/* Header */}
      <div className="flex flex-col items-center pt-12 pb-6 px-6">
        <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-4">
          <svg viewBox="0 0 24 24" className="w-9 h-9 text-white fill-current">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16zm0-6h2v1.5H9V10z"/>
          </svg>
        </div>
        <h1 className="text-3xl font-bold text-white tracking-tight">Understand</h1>
        <p className="text-blue-100 text-center mt-2 text-base leading-snug">
          Listen to any document<br />in your own language
        </p>
      </div>

      {/* Main card */}
      <div className="flex-1 bg-white rounded-t-3xl px-6 pt-8 pb-6 flex flex-col gap-5">
        <p className="text-gray-500 text-sm text-center font-medium uppercase tracking-wide">
          Step 1 — Add your document
        </p>

        {/* Camera button */}
        <button
          onClick={() => cameraInputRef.current?.click()}
          className="flex items-center gap-4 w-full bg-primary-600 hover:bg-primary-700 active:bg-primary-800 text-white rounded-2xl px-6 py-5 transition-colors shadow-lg shadow-blue-200"
        >
          <span className="text-3xl">📷</span>
          <div className="text-left">
            <p className="font-bold text-lg leading-tight">Take a Photo</p>
            <p className="text-blue-200 text-sm">Use your camera</p>
          </div>
          <svg className="w-5 h-5 ml-auto opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Upload button */}
        <button
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-4 w-full bg-white hover:bg-gray-50 active:bg-gray-100 text-gray-800 rounded-2xl px-6 py-5 transition-colors border-2 border-gray-200"
        >
          <span className="text-3xl">🖼️</span>
          <div className="text-left">
            <p className="font-bold text-lg leading-tight">Upload from Gallery</p>
            <p className="text-gray-400 text-sm">Choose an existing photo</p>
          </div>
          <svg className="w-5 h-5 ml-auto text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Drag and drop area */}
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`
            flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed
            py-8 cursor-pointer transition-all
            ${dragging ? 'border-primary-500 bg-primary-50' : 'border-gray-200 bg-gray-50 hover:border-primary-300 hover:bg-primary-50'}
          `}
        >
          <span className="text-2xl">⬆️</span>
          <p className="text-gray-400 text-sm">or drag &amp; drop here</p>
        </div>

        {/* Hidden file inputs */}
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFileChange} />
        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={onFileChange} />

        {/* Tips */}
        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex gap-3">
          <span className="text-lg">💡</span>
          <p className="text-amber-700 text-xs leading-relaxed">
            <strong>Tips for best results:</strong> Make sure the document is flat, well-lit, and all text is clearly visible.
          </p>
        </div>
      </div>
    </div>
  )
}
