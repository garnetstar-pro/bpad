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
        // 'any' and 'maskable' are separate files on purpose: Android crops a
        // maskable icon to a launcher shape, so it carries a margin the plain
        // icon must not have. See scripts/generate-icons.py.
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
          { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
