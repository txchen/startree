import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [vue()],
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
