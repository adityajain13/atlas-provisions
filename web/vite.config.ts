import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  base: '/provisions/',
  plugins: [react()],
  build: {
    outDir: 'dist/provisions',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // React and the router change rarely, so they get their own cached file.
        manualChunks(id) {
          if (/node_modules[\\/](react|react-dom|scheduler|react-router|react-router-dom|@remix-run)[\\/]/.test(id)) return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    proxy: {
      '/provisions/api': 'http://127.0.0.1:8787',
    },
  },
});
