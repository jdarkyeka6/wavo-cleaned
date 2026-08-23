import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import './ui-overrides.css'
import App from './App.jsx'
import ConfigError from './ConfigError.jsx'
import NotificationSetup from './NotificationSetup.jsx'
import UiEnhancements from './UiEnhancements.jsx'
import WavesPage from './WavesPage.jsx'
import { isConfigured } from './lib/config'

function WavoApp() {
  return (
    <>
      <App />
      <NotificationSetup />
      <UiEnhancements />
    </>
  )
}

// A build with no Supabase config cannot work, and used to fail by throwing
// inside supabaseClient before React mounted — leaving a black screen with
// nothing to read. Say what's wrong instead.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConfigured ? (
      <BrowserRouter>
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
