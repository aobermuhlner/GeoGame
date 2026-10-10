import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: { bindings: { DEV_LOGIN: 'true', ADMIN_TOKEN: 'test-admin-token', GOOGLE_CLIENT_ID: 'test-client.apps.googleusercontent.com' } },
    }),
  ],
});
