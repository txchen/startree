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
        rollupFormat: 'iife',
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
  run: {
    tasks: {
      'verify:local:built': {
        command: 'node scripts/verify-local-worker.mjs',
        dependsOn: ['build'],
        cache: false,
      },
      'verify:auxiliary': {
        command: ['npm test', 'npm run verify:migrations', 'npm run verify:config'],
        cache: false,
      },
      'verify:all': {
        command: 'node -e ""',
        dependsOn: ['check', 'verify:performance-data', 'verify:auxiliary', 'verify:local:built'],
        cache: false,
      },
      'verify:ci': {
        command: 'node -e ""',
        dependsOn: ['build', 'check', 'verify:performance-data', 'verify:auxiliary'],
        cache: false,
      },
    },
  },
});
