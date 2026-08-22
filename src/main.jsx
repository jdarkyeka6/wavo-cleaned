import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import ConfigError from './ConfigError.jsx'
import NotificationSetup from './NotificationSetup.jsx'
import { isConfigured } from './lib/config'
import { isNativeApp } from './lib/platform'
import './native-redesign.css'

// The iOS app and the public website share React source. Mark only the
// Capacitor runtime so native presentation can evolve without changing web.
document.documentElement.dataset.wavoNative = isNativeApp ? 'true' : 'false'

// A build with no Supabase config cannot work, and used to fail by throwing
// inside supabaseClient before React mounted — leaving a black screen with
// nothing to read. Say what's wrong instead.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    {isConfigured ? (
      <BrowserRouter>
        <App />
        <NotificationSetup />
      </BrowserRouter>
    ) : (
      <ConfigError />
    )}
  </StrictMode>,
)