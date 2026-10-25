import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  server: {
    proxy: {
      '/mojang': {
        target: 'https://piston-meta.mojang.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mojang/, ''),
      },
    },
  },
});
