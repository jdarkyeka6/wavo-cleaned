import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import './index.css'
import './ui-overrides.css'
import './admin.css'
import './premium-pro-chat-fix.css'
import './employee-work-visibility.css'
import './call-resilience.js'
import './call-signaling-resilience.js'
import './chat-call-peer-fix.js'
import './chat-keyboard-viewport.js'
import './chat-scroll-anchor.js'
import './place-markers.js'
import AccountDeletion from './AccountDeletion.jsx'
import App from './App.jsx'
import AdminRoute from './AdminRoute.jsx'
import CallContinuityBridge from './CallContinuityBridge.jsx'
import CallKitCoordinator from './CallKitCoordinator.jsx'
import CallQualityOverlay from './CallQualityOverlay.jsx'
import CallTimeoutGuard from './CallTimeoutGuard.jsx'
import ChatMotionCalls from './ChatMotionCalls.js'
import ConfigError from './ConfigError.jsx'
import DropInVoice from './DropInVoice.jsx'
import EmployeeWorkTracking from './EmployeeWorkTrackingSafe.jsx'
import GroupVideoCalls from './GroupVideoCalls.jsx'
import LiveActivityCoordinator from './LiveActivityCoordinator.jsx'
import NativeContentSafety from './NativeContentSafety.jsx'
import NativeReviewHardening from './NativeReviewHardening.jsx'
import NativeStoreKitBridge from './NativeStoreKitBridge.jsx'
import NotificationSetup from './NotificationSetup.jsx'
import PeopleDashboard from './PeopleDashboard.jsx'
import PersonalizedCore from './PersonalizedCore.jsx'
import Phase3Hub from './Phase3Hub.jsx'
import PlanComparison from './PlanComparison.jsx'
import PlusPlanEnhancement from './PlusPlanEnhancement.jsx'
import PremiumCosmeticsEnhancement from './PremiumCosmeticsEnhancement.jsx'
import PremiumProEnhancement from './PremiumProEnhancement.jsx'
import ProfileSupportEnhancement from './ProfileSupportEnhancement.jsx'
import SmartMessageActions from './SmartMessageActions.jsx'
import SpotifyPresenceCoordinator from './SpotifyPresenceCoordinator.jsx'
import SubscriptionManagement from './SubscriptionManagement.jsx'
import SupportPage from './SupportPage.jsx'
import UiEnhancements from './UiEnhancements.jsx'
import UsernameSettings from './UsernameSettings.jsx'
import WavoTogether from './WavoTogether.jsx'
import VideoWavesPage from './VideoWavesPage.jsx'
import { installAuthBootResilience } from './auth-boot-resilience.js'
import { isConfigured } from './lib/config'
import { installUiMode } from './lib/layout'
import { canUsePaidFeatures, isNativeApp } from './lib/platform'
import './responsive-platform.css'
import './responsive-platform-edge.css'
import './chat-keyboard-viewport.css'
import './chat-viewport-final.css'

installAuthBootResilience()
installUiMode()
const paidFeaturesEnabled = canUsePaidFeatures()

function isStandaloneWavesHost() {
  if (typeof window === 'undefined') return false
  return ['wavowaves.lol', 'www.wavowaves.lol'].includes(window.location.hostname)
}

function WavoApp() {
  return (
    <>
      <App />
      {paidFeaturesEnabled && <PremiumProEnhancement />}
      {paidFeaturesEnabled && <PlusPlanEnhancement />}
      {paidFeaturesEnabled && <NativeStoreKitBridge />}
      <NativeReviewHardening />
      <NativeContentSafety />
      {paidFeaturesEnabled && <PlanComparison />}
      {paidFeaturesEnabled && <PremiumCosmeticsEnhancement />}
      {paidFeaturesEnabled && <SubscriptionManagement />}
      <ProfileSupportEnhancement />
      <AccountDeletion />
      <PersonalizedCore />
      <NotificationSetup />
      <UiEnhancements />
      <ChatMotionCalls />
      <CallTimeoutGuard />
      <CallQualityOverlay />
      <CallContinuityBridge />
      <DropInVoice />
      <GroupVideoCalls />
      <WavoTogether />
      <Phase3Hub />
      <PeopleDashboard />
      <SmartMessageActions />
      <SpotifyPresenceCoordinator />
      <LiveActivityCoordinator />
      <UsernameSettings />
    </>
  )
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConfigured ? (
      isStandaloneWavesHost() ? (
        <VideoWavesPage />
      ) : (
      <BrowserRouter>
        <CallKitCoordinator />
        {!isNativeApp && <EmployeeWorkTracking />}
        <Routes>
          <Route path="/waves" element={<VideoWavesPage />} />
          <Route path="/waves/video" element={<VideoWavesPage />} />
          <Route path="/support" element={<SupportPage />} />
          <Route path="/admin" element={<AdminRoute />} />
          <Route path="*" element={<WavoApp />} />
        </Routes>
      </BrowserRouter>
      )
    ) : (
      <ConfigError />
    )}
  </StrictMode>,
)
