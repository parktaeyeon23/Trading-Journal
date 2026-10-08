/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// GitHub Pages serves the app from /<repo>/. Override with BASE=/ for other hosts.
const base = process.env.BASE ?? '/Trading-Journal/'

export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      workbox: {
        // Chart pictures never change once uploaded (a replacement gets a new file id),
        // so keep them for offline viewing. Cross-origin <img> loads are opaque (status 0),
        // and browsers charge opaque entries heavily against quota — hence the modest cap.
        runtimeCaching: [
          // Fonts: the stylesheet can change (StaleWhileRevalidate), the font files never do.
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.googleapis.com',
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'google-fonts-css' },
          },
          {
            urlPattern: ({ url }) => url.hostname === 'fonts.gstatic.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 365 },
            },
          },
          {
            urlPattern: ({ url }) =>
              (url.hostname === 'drive.google.com' && url.pathname === '/thumbnail') ||
              url.hostname.endsWith('.googleusercontent.com') ||
              url.hostname === 's3.tradingview.com',
            handler: 'CacheFirst',
            options: {
              cacheName: 'chart-images',
              cacheableResponse: { statuses: [0, 200] },
              expiration: { maxEntries: 150, maxAgeSeconds: 60 * 60 * 24 * 90 },
            },
          },
        ],
      },
      manifest: {
        name: 'ALPHA JOURNAL',
        short_name: 'ALPHA',
        description: '단기 추세추종 트레이더를 위한 투자일지',
        lang: 'ko',
        theme_color: '#0B7D3E',
        background_color: '#F4F6F5',
        display: 'standalone',
        start_url: '.',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
        ],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { include: ['src/core/**'] },
  },
})
