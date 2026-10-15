import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Izinkan preview melalui host tunnel (mis. preview sandbox / ngrok) di mode dev.
    allowedHosts: true,
  },
  build: {
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('xlsx')) return 'vendor-xlsx'
          if (id.includes('recharts') || id.includes('d3-')) return 'vendor-charts'
          if (id.includes('html5-qrcode') || id.includes('qrcode') || id.includes('jsbarcode')) {
            return 'vendor-barcode'
          }
          if (id.includes('@supabase')) return 'vendor-supabase'
          return 'vendor'
        },
      },
    },
  },
})
