import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,   // เปิดให้ iPad เข้าถึงได้ผ่าน WiFi เดียวกัน
    port: 5174,
  },
})
