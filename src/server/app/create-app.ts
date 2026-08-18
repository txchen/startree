import { Hono } from 'hono';
import * as v from 'valibot';

import { platformStatusSchema } from '../../shared/platform/contracts';
import { errorResponse, requestIdFor } from './errors';
import { securityHeaders } from './security';
import type { AppEnvironment, CoreBindings } from './types';

export const createApp = <Bindings extends CoreBindings>(
  readBookmarkRevision: (bindings: Bindings) => Promise<number>,
) => {
  const app = new Hono<AppEnvironment<Bindings>>();

  app.use('*', securityHeaders<Bindings>());

  app.get('/api/v1/platform', async (context) => {
    const payload = v.parse(platformStatusSchema, {
      apiVersion: 1,
      application: 'startree',
      bookmarkRevision: await readBookmarkRevision(context.env),
      version: context.env.APP_VERSION,
    });

    return context.json(payload);
  });

  app.notFound((context) => {
    if (context.req.path.startsWith('/api/')) {
      return errorResponse(context, 404, 'not_found', 'route', 'The API route does not exist.');
    }

    return context.env.ASSETS.fetch(context.req.raw);
  });

  app.onError((error, context) => {
    const requestId = requestIdFor(context);
    console.error(
      JSON.stringify({
        event: 'uncaught_exception',
        exceptionType: error.name,
        requestId,
        version: context.env.APP_VERSION,
      }),
    );

    return context.json(
      {
        error: {
          code: 'internal_error',
          operation: 'request',
          message: 'The request could not be completed.',
          requestId,
          version: context.env.APP_VERSION,
        },
      } satisfies import('../../shared/platform/contracts').ApiError,
      500,
    );
  });

  return app;
};
