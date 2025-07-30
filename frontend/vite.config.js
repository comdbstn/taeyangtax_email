import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // 빌드 시 모든 경로를 상대 경로로 변경하여
  // 어떤 경로에 배포되든 파일을 올바르게 찾도록 함
  base: './', 
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  build: {
    outDir: 'dist',
  },
});
