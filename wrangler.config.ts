import { defineWranglerConfig } from 'wrangler/experimental-config';

// cf owns deployment and resources; this file configures only its build/dev adapter.
export default defineWranglerConfig({
  types: { generate: true, includeRuntime: false },
  assetsDirectory: './dist',
  dev: {
    port: Number(process.env.STARTREE_DEV_PORT || 8787),
    inspectorPort: Number(process.env.STARTREE_DEV_PORT || 8787) + 447,
  },
});
