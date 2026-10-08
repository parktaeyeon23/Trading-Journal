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
      includeAssets: ['icon.svg'],
      workbox: {
        // Chart pictures never change once uploaded (a replacement gets a new file id),
        // so keep them for offline viewing. Cross-origin <img> loads are opaque (status 0),
        // and browsers charge opaque entries heavily against quota — hence the modest cap.
        runtimeCaching: [
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
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { include: ['src/core/**'] },
  },
})
