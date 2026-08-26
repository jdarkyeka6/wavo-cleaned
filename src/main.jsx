import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import './ui-overrides.css'
import App from './App.jsx'
import AdminRoute from './AdminRoute.jsx'
import ConfigError from './ConfigError.jsx'
import NotificationSetup from './NotificationSetup.jsx'
import UiEnhancements from './UiEnhancements.jsx'
import WavePhotoBridge from './WavePhotoBridge.jsx'
import WavesPageV2 from './WavesPageV2.jsx'
import { isConfigured } from './lib/config'
import { installUiMode } from './lib/layout'
import './responsive-platform.css'
import './responsive-platform-edge.css'

installUiMode()

function WavoApp() {
  return (
    <>
      <App />
      <NotificationSetup />
      <UiEnhancements />
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConfigured ? (
      <BrowserRouter>
        <WavePhotoBridge />
        <Routes>
          <Route path="/waves" element={<WavesPageV2 />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="*" element={<WavoApp />} />
        </Routes>
      </BrowserRouter>
    ) : (
      <ConfigError />
    )}
  </StrictMode>,
)
