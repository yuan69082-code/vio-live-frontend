import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const defaultBackendTarget = 'http://127.0.0.1:8787'

export default defineConfig(({ mode }) => {
  const environment = loadEnv(mode, '.', 'VITE_')
  const backendTarget = environment.VITE_BACKEND_PROXY_TARGET?.trim() || defaultBackendTarget

  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
        },
        '/health': {
          target: backendTarget,
          changeOrigin: true,
        },
      },
    },
  }
})
