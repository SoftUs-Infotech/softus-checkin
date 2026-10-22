import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// The API is same-origin in development, so cookies and the device headers
// behave exactly as they will in production.
const API_PROXY = {
  '/api': {
    target: process.env.VITE_API_TARGET ?? 'http://127.0.0.1:8000',
    changeOrigin: true,
  },
}

export default defineConfig(({ mode }) => {
  // On Vercel the API lives on another origin. Without VITE_API_BASE the bundle
  // would call /api/v1 on the static host and every request would 404 — so the
  // deployment fails at build time instead of after somebody tries to sign in.
  const env = loadEnv(mode, process.cwd(), '')
  if (process.env.VERCEL && mode === 'production' && !env.VITE_API_BASE) {
    throw new Error(
      'VITE_API_BASE is not set. Add it in Vercel > Settings > Environment Variables, ' +
        'e.g. https://api.example.com/api/v1',
    )
  }
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { '@': path.resolve(import.meta.dirname, './src') },
    },
    server: {
      port: 5173,
      host: true,
      // Dev only: a tunnel (localtunnel, ngrok, Cloudflare) arrives with a host
      // header Vite does not know, and would otherwise be refused.
      allowedHosts: true,
      proxy: API_PROXY,
    },
    // `vite preview` serves the built bundle. It is what a tunnel should point at:
    // one JS file instead of the dev server's hundreds of module requests.
    preview: {
      port: 4173,
      host: true,
      allowedHosts: true,
      proxy: API_PROXY,
    },
  }
})
