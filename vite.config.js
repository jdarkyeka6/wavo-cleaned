import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Root-relative assets work on nested browser routes and Capacitor's local origin.
  base: '/',
  plugins: [react()],
})
