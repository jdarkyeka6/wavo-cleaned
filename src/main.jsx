import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import './ui-overrides.css'
import App from './App.jsx'
import AppStoreSafety from './AppStoreSafety.jsx'
import ConfigError from './ConfigError.jsx'
import NotificationSetup from './NotificationSetup.jsx'
import UiEnhancements from './UiEnhancements.jsx'
import WavePhotoBridge from './WavePhotoBridge.jsx'
import WaveSafetyBridge from './WaveSafetyBridge.jsx'
import WavesPage from './WavesPage.jsx'
import { isConfigured } from './lib/config'
import { installUiMode } from './lib/layout'
import './responsive-platform.css'
import './responsive-platform-edge.css'
import './app-store-submit-overrides.css'

// Decide the presentation before React paints. This gives every screen one
// reliable source of truth: desktop-web, mobile-web, or mobile-app.
installUiMode()

function WavoApp() {
  return (
    <>
      <App />
      <NotificationSetup />
      <UiEnhancements />
      <AppStoreSafety />
    </>
  )
}

// A build with no Supabase config cannot work, and used to fail by throwing
// inside supabaseClient before React mounted, leaving a black screen with
// nothing to read. Say what's wrong instead.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConfigured ? (
      <BrowserRouter>
        <WavePhotoBridge />
        <WaveSafetyBridge />
        <Routes>
          <Route path="/waves" element={<WavesPage />} />
          <Route path="*" element={<WavoApp />} />
        </Routes>
      </BrowserRouter>
    ) : (
      <ConfigError />
    )}
  </StrictMode>,
)
