import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/provisions/',
  plugins: [react()],
  build: {
    outDir: 'dist/provisions',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/provisions/api': 'http://127.0.0.1:8787',
    },
  },
});
