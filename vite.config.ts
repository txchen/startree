import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    vue(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src/client',
      filename: 'service-worker.ts',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        globPatterns: ['**/*.{html,js,css,svg,png,ico,woff2}'],
      },
    }),
  ],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
  lint: {
    ignorePatterns: ['dist/**', 'worker-configuration.d.ts'],
  },
  fmt: {
    ignorePatterns: ['dist/**', 'worker-configuration.d.ts', 'package-lock.json'],
    singleQuote: true,
  },
});
