import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import './ui-overrides.css'
import './call-resilience.js'
import './chat-call-peer-fix.js'
import './chat-keyboard-viewport.js'
import App from './App.jsx'
import AdminRoute from './AdminRoute.jsx'
import CallContinuityBridge from './CallContinuityBridge.jsx'
import CallKitCoordinator from './CallKitCoordinator.jsx'
import CallQualityOverlay from './CallQualityOverlay.jsx'
import ChatMotionCalls from './ChatMotionCalls.js'
import ConfigError from './ConfigError.jsx'
import DropInVoice from './DropInVoice.jsx'
import LiveActivityCoordinator from './LiveActivityCoordinator.jsx'
import NotificationSetup from './NotificationSetup.jsx'
import PeopleDashboard from './PeopleDashboard.jsx'
import SmartMessageActions from './SmartMessageActions.jsx'
import UiEnhancements from './UiEnhancements.jsx'
import WavePhotoBridge from './WavePhotoBridge.jsx'
import WavesPageV2 from './WavesPageV2.jsx'
import WavoTogether from './WavoTogether.jsx'
import { isConfigured } from './lib/config'
import { installUiMode } from './lib/layout'
import './responsive-platform.css'
import './responsive-platform-edge.css'
import './chat-keyboard-viewport.css'

installUiMode()

function WavoApp() {
  return (
    <>
      <App />
      <NotificationSetup />
      <UiEnhancements />
      <ChatMotionCalls />
      <CallQualityOverlay />
      <CallContinuityBridge />
      <DropInVoice />
      <WavoTogether />
      <PeopleDashboard />
      <SmartMessageActions />
      <LiveActivityCoordinator />
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConfigured ? (
      <BrowserRouter>
        <WavePhotoBridge />
        <CallKitCoordinator />
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
