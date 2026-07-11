import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registraci si zavoláme sami v main.tsx (kvůli přísné CSP – žádný inline skript).
      injectRegister: null,
      manifest: {
        name: 'bpad',
        short_name: 'bpad',
        description: 'Šifrovaný zápisník',
        theme_color: '#0E1524',
        background_color: '#0E1524',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        // /api nikdy necachovat – šifrované poznámky si appka ukládá sama.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
})
