import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import chatRestorePlugin from './chat-restore-vite.js'

// Keep the restoration plugin before React so it patches the JSX source that
// both the normal web build and the TestFlight workflow compile.
export default defineConfig({
  base: './',
  plugins: [chatRestorePlugin(), react()],
})
