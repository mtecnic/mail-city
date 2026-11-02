import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const shared = resolve('src/shared')
const kernel = resolve('src/kernel')

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared, '@kernel': kernel } },
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          'sync-worker': resolve('src/main/workers/sync-worker.ts'),
          'mcp-stdio': resolve('src/main/workers/mcp-stdio.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': shared } }
  },
  renderer: {
    resolve: { alias: { '@shared': shared, '@renderer': resolve('src/renderer/src') } },
    plugins: [react(), tailwindcss()]
  }
})
