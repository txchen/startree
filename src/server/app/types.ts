export type CoreBindings = {
  APP_VERSION: string;
  ASSETS: Pick<Fetcher, 'fetch'>;
};

export type AppEnvironment<Bindings extends CoreBindings = CoreBindings> = {
  Bindings: Bindings;
};
