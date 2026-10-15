import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: Number(process.env.WEB_PORT || 5173),
    strictPort: Boolean(process.env.WEB_PORT),
    proxy: { '/api': `http://127.0.0.1:${process.env.PORT || 3001}` },
  },
  test: { include: ['tests/**/*.test.ts'] },
} as Parameters<typeof defineConfig>[0]);
