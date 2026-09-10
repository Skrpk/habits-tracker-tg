import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Pin the timezone: production (Vercel) runs UTC, and several date helpers
    // are server-TZ dependent. Without this, a developer's local zone can mask
    // real bugs — a Europe/Prague machine (UTC+2) silently cancelled the
    // double-timezone-conversion bug in the reminder scheduler.
    env: { TZ: 'UTC' },
    include: ['__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['api/**/*.ts', 'src/api/**/*.ts'],
      exclude: ['**/*.test.ts', '**/node_modules/**'],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
