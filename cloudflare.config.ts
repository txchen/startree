import { bindings, defineConfig } from 'cf/config';
import { getEnvironment } from './cloudflare.environments.ts';

export default defineConfig((ctx) => {
  const environment = getEnvironment(ctx.mode);
  return {
    worker: {
      name: environment.name,
      entrypoint: 'src/server/index.ts',
      compatibilityDate: '2026-08-18',
      compatibilityFlags: ['nodejs_compat'],
      workersDev: ctx.mode === 'preview',
      previewUrls: false,
      domains: ctx.mode === 'production' ? ['startree.txchen.win'] : [],
      observability: { enabled: true, headSamplingRate: 1 },
      assets: { notFoundHandling: 'single-page-application', runWorkerFirst: true },
      env: {
        APP_VERSION: bindings.text(process.env.STARTREE_RELEASE_REVISION || ctx.mode),
        DB: bindings.d1({ name: environment.databaseName, id: environment.databaseId }),
        MUTATION_RATE_LIMITER: bindings.rateLimit({
          namespace: environment.namespace,
          simple: { limit: 120, period: 60 },
        }),
        ASSETS: bindings.assets(),
      },
    },
  };
});
