/**
 * Generates PWA icon PNGs directly from public/icon.svg using sharp.
 * No padding is added — the blue fills edge-to-edge on regular icons.
 * The maskable variant adds the mandatory 10 % safe-zone on each side
 * (Android adaptive icon spec) filled with the app's cobalt blue.
 */

import sharp from 'sharp'
import { readFileSync } from 'fs'

const svg = readFileSync('public/icon.svg')

// Cobalt blue background for maskable safe zone  (#2E5BFF)
const COBALT = { r: 46, g: 91, b: 255, alpha: 1 }

async function png(size, dest) {
  await sharp(svg)
    .resize(size, size)
    .png({ compressionLevel: 9 })
    .toFile(dest)
  console.log(`  ✔ ${dest}`)
}

async function maskable(totalSize, dest) {
  const pad    = Math.round(totalSize * 0.10)   // 10 % each side
  const inner  = totalSize - pad * 2
  const icon   = await sharp(svg).resize(inner, inner).png().toBuffer()

  await sharp({
    create: { width: totalSize, height: totalSize, channels: 4, background: COBALT }
  })
    .composite([{ input: icon, top: pad, left: pad }])
    .png({ compressionLevel: 9 })
    .toFile(dest)
  console.log(`  ✔ ${dest}  (maskable, ${pad}px safe-zone)`)
}

console.log('Generating PWA icons…')
await png(192, 'public/pwa-192x192.png')
await png(512, 'public/pwa-512x512.png')
await png(180, 'public/apple-touch-icon-180x180.png')
await maskable(512, 'public/maskable-icon-512x512.png')
console.log('Done.')
