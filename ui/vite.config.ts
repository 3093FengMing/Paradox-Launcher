import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { instrumentSites } from './src/customization/site-transform';

export default defineConfig({
  plugins: [
    {
      name: 'ui-shared-sites',
      enforce: 'pre',
      transform(source, id) {
        if (!/\.tsx?(?:$|\?)/.test(id) || id.includes('/node_modules/')) return;
        if (/@jsxImportSource\s+react\b/.test(source)) return;
        return { code: instrumentSites(source, id.split('?')[0], 'tsx').source, map: null };
      },
    },
    react({ jsxImportSource: '@custom-ui' }),
    {
      name: 'custom-ui-runtime-source',
      configResolved(config) {
        // The React plugin explicitly prebundles its automatic JSX runtime.
        // This app runtime must share the original context modules with the HOCs.
        config.optimizeDeps.include = (config.optimizeDeps.include ?? []).filter(
          (id) => !id.startsWith('@custom-ui/'),
        );
      },
    },
  ],
  resolve: {
    alias: {
      '@custom-ui': fileURLToPath(new URL('./src/customization', import.meta.url)),
      '@paradox/launcher': fileURLToPath(
        new URL('./src/launcher/public/index.ts', import.meta.url),
      ),
      '@paradox/ui': fileURLToPath(new URL('./src/ui-foundation/index.ts', import.meta.url)),
    },
  },
  optimizeDeps: { exclude: ['@custom-ui/jsx-runtime', '@custom-ui/jsx-dev-runtime'] },
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
