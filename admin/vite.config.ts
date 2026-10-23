import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// 배포 주소(/admin/)에서도 관리 API(/be/api/v1/admin/**)를 같은 도메인으로 부른다.
// 백엔드 주소는 API_PROXY_TARGET으로 바꾼다. 예: API_PROXY_TARGET=http://localhost:8081
export default defineConfig({
  base: '/admin/',
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      '/be/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://localhost:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/be/, ''),
      },
    },
  },
})
