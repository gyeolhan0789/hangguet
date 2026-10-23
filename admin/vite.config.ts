import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 관리 API(/api/v1/admin/**)는 같은 주소로 부르고 개발 서버가 백엔드로 넘긴다(CORS 없음).
// 백엔드 주소는 API_PROXY_TARGET으로 바꾼다. 예: API_PROXY_TARGET=http://localhost:8081
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8080',
    },
  },
})
