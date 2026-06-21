import { useEffect, useState } from 'react'

export default function SplashScreen({ onDone }) {
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const t1 = setTimeout(() => setFading(true), 2400)
    const t2 = setTimeout(() => onDone(),        2900)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [onDone])

  return (
    <div
      className={`fixed inset-0 z-[9999] flex flex-col items-center justify-center
        bg-gradient-to-b from-primary-700 to-primary-500
        transition-opacity duration-500 ${fading ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      {/* Animated icon */}
      <div className="splash-icon w-28 h-28 bg-white/15 rounded-[32px] flex items-center justify-center mb-8 backdrop-blur-sm">
        <svg viewBox="0 0 24 24" className="w-16 h-16 fill-white drop-shadow-lg">
          <path d="M14 2H6C4.9 2 4 2.9 4 4v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM9 13h6v1.5H9V13zm0 3h4v1.5H9V16zm0-6h2v1.5H9V10z"/>
        </svg>
      </div>

      <h1 className="splash-title text-white font-black tracking-[0.22em] text-4xl">
        UNDERSTAND
      </h1>

      <p className="splash-sub text-white/55 text-sm mt-3 tracking-wider font-medium">
        Documents · Traduction · Audio
      </p>

      <div className="splash-dots absolute flex gap-2" style={{ bottom: 'max(env(safe-area-inset-bottom, 0px), 48px)' }}>
        <span className="w-2 h-2 rounded-full bg-white/80 dot-1" />
        <span className="w-2 h-2 rounded-full bg-white/40 dot-2" />
        <span className="w-2 h-2 rounded-full bg-white/20 dot-3" />
      </div>
    </div>
  )
}
