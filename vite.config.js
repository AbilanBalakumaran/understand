import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Understand',
        short_name: 'Understand',
        description: 'Translate any document into your language and listen to it',
        theme_color: '#2E5BFF',
        background_color: '#F4F6FF',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/understand/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml' }
        ]
      }
    })
  ],
  base: '/understand/'
})
