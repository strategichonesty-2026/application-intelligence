import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// The built site is served by server/index.cjs from ./dist on the same origin as the API.
export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': 'http://localhost:3002' } }, // local development: the API server (npm start, PORT=3002)
})
