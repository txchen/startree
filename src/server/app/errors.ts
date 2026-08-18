import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { ApiError } from '../../shared/platform/contracts';
import type { AppEnvironment, CoreBindings } from './types';

export const requestIdFor = <Bindings extends CoreBindings>(
  context: Context<AppEnvironment<Bindings>>,
): string => context.req.header('cf-ray') ?? crypto.randomUUID();

export const errorResponse = <Bindings extends CoreBindings>(
  context: Context<AppEnvironment<Bindings>>,
  status: ContentfulStatusCode,
  code: string,
  operation: string,
  message: string,
) => {
  const body: ApiError = {
    error: {
      code,
      operation,
      message,
      requestId: requestIdFor(context),
      version: context.env.APP_VERSION,
    },
  };

  return context.json(body, status);
};
