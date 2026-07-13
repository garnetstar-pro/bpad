import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      // 'prompt' = the new SW waits until the user clicks "Update"
      // (UpdatePrompt), instead of a silent auto-reload.
      registerType: 'prompt',
      // We register the SW ourselves (via useRegisterSW) — no inline script,
      // because of the strict CSP.
      injectRegister: null,
      manifest: {
        name: 'bpad',
        short_name: 'bpad',
        description: 'Encrypted notebook',
        theme_color: '#0E1524',
        background_color: '#0E1524',
        display: 'standalone',
        start_url: '/',
        icons: [
          // Vector first: crisp at any size on platforms that support SVG icons
          // (e.g. Chrome/Android). PNGs are the fallback (e.g. iOS).
          { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' },
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: '/index.html',
        // Never cache /api — the app stores its encrypted notes itself.
        navigateFallbackDenylist: [/^\/api/],
      },
    }),
  ],
})
