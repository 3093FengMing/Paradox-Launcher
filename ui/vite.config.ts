import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { instrumentSites } from './src/customization/site-transform';
import { builtinGraphPlansPlugin } from './src/ui-suite/build-graph-plugin';

export default defineConfig({
  plugins: [
    builtinGraphPlansPlugin(fileURLToPath(new URL('.', import.meta.url))),
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
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const path = id.replaceAll('\\', '/');
          const tree = /\/ui-suite\/builtins\/(common|modern|immersive)\//.exec(path);
          // Bundles read a source tree together. Keep catalog manifests independently loadable.
          if (tree && /\?(?:raw|inline)(?:&|$)/.test(path) && !path.includes('/suite.json?'))
            return `builtin-source-${tree[1]}`;
        },
      },
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
