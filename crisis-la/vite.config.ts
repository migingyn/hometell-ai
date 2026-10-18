import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    host: '127.0.0.1', port: 5175, strictPort: true,
    proxy: { '/api/health': { target: process.env.HEARTBEAT_API_TARGET || 'http://127.0.0.1:3017', changeOrigin: true }, '/api/prescription': { target: process.env.PRESCRIPTION_API_TARGET || 'http://127.0.0.1:3017', changeOrigin: true } },
    fs: { allow: ['..'] },
  },
  build: { chunkSizeWarningLimit: 700 },
});
