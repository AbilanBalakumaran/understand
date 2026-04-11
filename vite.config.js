import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'Understand',
        short_name: 'Understand',
        description: 'Translate any document into your language and listen to it',
        theme_color: '#2563EB',
        background_color: '#EFF6FF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/understand/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' }
        ]
      }
    })
  ],
  base: '/understand/'
})
