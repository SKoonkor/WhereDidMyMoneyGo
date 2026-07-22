/// <reference lib="webworker" />
// Custom service worker (vite-plugin-pwa `injectManifest` mode). It replaces the
// previously auto-generated SW and must preserve its behaviour:
//   • precache the app shell (the injected __WB_MANIFEST),
//   • runtime-cache the lazy-loaded Plotly bundle (CacheFirst, 90 days),
//   • auto-update (skipWaiting + clientsClaim), matching the old autoUpdate.
// It additionally handles `notificationclick` so tapping a daily reminder focuses
// or opens the app (the scheduling side lands in P3).
import { cleanupOutdatedCaches, precacheAndRoute, type PrecacheEntry } from 'workbox-precaching'
import { registerRoute } from 'workbox-routing'
import { CacheFirst } from 'workbox-strategies'
import { ExpirationPlugin } from 'workbox-expiration'
import { clientsClaim } from 'workbox-core'

// __WB_MANIFEST is the precache list injected by vite-plugin-pwa at build time.
declare let self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | PrecacheEntry)[] }

self.skipWaiting()
clientsClaim()

// Precache + serve the app shell; drop stale precaches from prior versions.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// Plotly (~4.6 MB, lazy-loaded on dashboards) — cache-first for 90 days so charts
// work offline after their first view. Mirrors the previous generateSW config.
registerRoute(
  /\/assets\/plotly.*\.js$/,
  new CacheFirst({
    cacheName: 'plotly-lib',
    plugins: [new ExpirationPlugin({ maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 90 })],
  }),
)

// Tapping a reminder notification focuses an existing window, else opens one.
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      for (const client of clients) {
        if ('focus' in client) return client.focus()
      }
      if (self.clients.openWindow) await self.clients.openWindow(self.registration.scope)
    })(),
  )
})
