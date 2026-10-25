import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

// https://vite.dev/config/
export default defineConfig({
  base: './',
  build: {
    sourcemap: true,
  },
  plugins: [
    vue(),
    nodePolyfills({
      include: ['buffer'],
      globals: {
        Buffer: true,
        global: false,
        process: false,
      },
    }),
  ],
  worker: {
    format: 'es',
  },
})
