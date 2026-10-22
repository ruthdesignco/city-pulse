import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { loadCityBase } from './city/useCity.ts'
import { loadRoutes } from './transit/useRoutes.ts'

// Start the baked data downloading now, alongside React's first render,
// rather than when the scene mounts and suspends on it. Failures surface
// where the data is used (the loaders clear a rejected promise, so that's a
// fresh try); here they're only kept from being reported as unhandled.
for (const load of [loadCityBase, loadRoutes]) load().catch(() => {})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
