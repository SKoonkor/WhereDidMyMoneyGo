/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// Base path: root for Netlify/custom domains; a repo sub-path for GitHub Pages
// (https://<user>.github.io/<repo>/). CI sets BASE_PATH="/WhereDidMyMoneyGo/".
const base = process.env.BASE_PATH || '/'

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Where Did My Money Go',
        short_name: 'MoneyGo',
        description:
          'Personal finance tracker — budgets, goals, retirement, and more. '
          + 'Your data stays on your device.',
        lang: 'en',
        theme_color: '#1abc9c',
        background_color: '#14181f',
        display: 'standalone',
        orientation: 'portrait',
        // start_url/scope are made base-relative by the plugin.
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Cache the built app shell so it opens offline once installed.
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
      },
      devOptions: { enabled: true },
    }),
  ],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: false,
  },
})
