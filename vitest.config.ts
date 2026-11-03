import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Workers-only module used by worker/src/mail.ts
      'cloudflare:email': fileURLToPath(new URL('./worker/src/testing/cloudflare-email.ts', import.meta.url)),
    },
  },
  test: {
    include: ['shared/**/*.test.ts', 'worker/**/*.test.ts'],
    environment: 'node',
  },
});
