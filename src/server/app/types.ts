export type CoreBindings = {
  APP_VERSION: string;
  ASSETS: Pick<Fetcher, 'fetch'>;
  MUTATION_RATE_LIMITER: RateLimit;
};

export type AppEnvironment<Bindings extends CoreBindings = CoreBindings> = {
  Bindings: Bindings;
};
