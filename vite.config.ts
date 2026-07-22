import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'
import type { ClientRequest } from 'node:http'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

  return {
    plugins: [vue()],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    server: {
      proxy: {
        // Browser WebSocket cannot set X-Api-* headers; Vite injects them locally.
        '/doubao-realtime': {
          target: 'wss://openspeech.bytedance.com',
          changeOrigin: true,
          ws: true,
          secure: true,
          rewrite: () => '/api/v3/realtime/dialogue',
          configure: (proxy) => {
            proxy.on('proxyReqWs', (proxyReq: ClientRequest) => {
              proxyReq.setHeader('X-Api-App-ID', env.DOUBAO_APP_ID || '')
              proxyReq.setHeader('X-Api-Access-Key', env.DOUBAO_ACCESS_KEY || '')
              proxyReq.setHeader(
                'X-Api-Resource-Id',
                env.DOUBAO_RESOURCE_ID || 'volc.speech.dialog',
              )
              proxyReq.setHeader(
                'X-Api-App-Key',
                env.DOUBAO_APP_KEY || 'PlgvMymc7f3tQnJ6',
              )
              proxyReq.setHeader('X-Api-Connect-Id', crypto.randomUUID())
            })
          },
        },
      },
    },
  }
})
