import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      'packages/shared/vitest.config.mts',
      'apps/server/vitest.config.mts',
      'apps/web/vitest.config.mts',
    ],
  },
});
