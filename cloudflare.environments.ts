export const environments = {
  local: {
    name: 'startree-local',
    databaseName: 'startree-local',
    databaseId: '00000000-0000-4000-8000-000000000020',
    namespace: '10020',
  },
  preview: {
    name: 'startree-preview',
    databaseName: 'startree-preview',
    databaseId: '6058ca3d-0168-4214-888c-88e597375377',
    namespace: '20020',
  },
  production: {
    name: 'startree',
    databaseName: 'startree-production',
    databaseId: '61de2cc1-4a03-4875-8bf8-306e7859350d',
    namespace: '30020',
  },
} as const;

export function getEnvironment(mode: string | undefined) {
  if (mode !== 'local' && mode !== 'preview' && mode !== 'production') {
    throw new Error('Select an explicit Cloudflare mode: local, preview, or production.');
  }
  return environments[mode];
}
