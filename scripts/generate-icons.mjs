/**
 * Generates PWA icon PNGs from public/icon.svg using sharp.
 *
 * Key points:
 *  - .flatten() fills any transparent pixels with cobalt blue BEFORE encoding.
 *    This guards against SVG renderers (librsvg, WebKit) that silently fail
 *    to resolve gradients and leave the background transparent — which then
 *    appears white on iOS home screen or Android launcher.
 *  - No padding on regular icons (full bleed, edge-to-edge blue).
 *  - Maskable icon gets the standard 10 % safe-zone padding filled with blue.
 */

import sharp from 'sharp'
import { readFileSync } from 'fs'

const svg = readFileSync('public/icon.svg')

// Cobalt blue — must match the SVG background colour (#2E5BFF)
const COBALT = { r: 46, g: 91, b: 255 }

/** Regular icon — full bleed, no padding, transparent pixels → blue. */
async function png(size, dest) {
  await sharp(svg)
    .resize(size, size)
    .flatten({ background: COBALT })   // ← critical: kills any transparent bg
    .png({ compressionLevel: 9 })
    .toFile(dest)
  console.log(`  ✔ ${dest}`)
}

/** Maskable icon — content scaled to 80 %, safe-zone filled with blue. */
async function maskable(totalSize, dest) {
  const pad   = Math.round(totalSize * 0.10)
  const inner = totalSize - pad * 2

  const icon = await sharp(svg)
    .resize(inner, inner)
    .flatten({ background: COBALT })
    .png()
    .toBuffer()

  await sharp({
    create: { width: totalSize, height: totalSize, channels: 4, background: { ...COBALT, alpha: 1 } }
  })
    .composite([{ input: icon, top: pad, left: pad }])
    .flatten({ background: COBALT })
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
