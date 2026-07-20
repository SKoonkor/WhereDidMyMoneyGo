import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import './theme.css'
import App from './App.tsx'
import { ensureSeeded } from './db'

// Register the service worker (offline shell + installable PWA). autoUpdate.
registerSW({ immediate: true })

// Seed first-run defaults (accounts / categories / settings) before first paint.
ensureSeeded().finally(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
