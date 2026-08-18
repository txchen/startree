import { Hono } from 'hono';
import * as v from 'valibot';

import {
  bookmarkCommandResultSchema,
  bookmarkCommandSchema,
  bookmarkSnapshotEtag,
  bookmarkSnapshotSchema,
  type BookmarkCommand,
  type BookmarkCommandResult,
  type BookmarkSnapshot,
} from '../../shared/bookmarks/contracts';
import { platformStatusSchema } from '../../shared/platform/contracts';
import { errorResponse, requestIdFor } from './errors';
import { securityHeaders } from './security';
import type { AppEnvironment, CoreBindings } from './types';

type AppServices<Bindings> = {
  readBookmarkRevision(bindings: Bindings): Promise<number>;
  readBookmarkSnapshot(bindings: Bindings): Promise<BookmarkSnapshot>;
  executeBookmarkCommand(
    command: BookmarkCommand,
    bindings: Bindings,
  ): Promise<BookmarkCommandResult>;
};

const MAX_COMMAND_BYTES = 1024 * 1024;

const readBoundedCommandBody = async (request: Request): Promise<string | null> => {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let byteLength = 0;
  let body = '';
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      byteLength += chunk.value.byteLength;
      if (byteLength > MAX_COMMAND_BYTES) {
        await reader.cancel();
        return null;
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
};

export const createApp = <Bindings extends CoreBindings>(services: AppServices<Bindings>) => {
  const app = new Hono<AppEnvironment<Bindings>>();

  app.use('*', securityHeaders<Bindings>());

  app.get('/api/v1/platform', async (context) => {
    const payload = v.parse(platformStatusSchema, {
      apiVersion: 1,
      application: 'startree',
      bookmarkRevision: await services.readBookmarkRevision(context.env),
      version: context.env.APP_VERSION,
    });

    return context.json(payload);
  });

  app.get('/api/bookmarks/snapshot', async (context) => {
    const snapshot = v.parse(
      bookmarkSnapshotSchema,
      await services.readBookmarkSnapshot(context.env),
    );
    const etag = bookmarkSnapshotEtag(snapshot.revision);
    context.header('ETag', etag);

    if (context.req.header('If-None-Match') === etag) {
      return context.body(null, 304);
    }

    return context.json(snapshot);
  });

  app.post('/api/bookmarks/commands', async (context) => {
    const contentType = context.req.header('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return errorResponse(
        context,
        415,
        'unsupported_media_type',
        'bookmark_command',
        'Bookmark commands require application/json.',
      );
    }

    const requestOrigin = context.req.header('Origin');
    if (!requestOrigin || requestOrigin !== new URL(context.req.url).origin) {
      return errorResponse(
        context,
        403,
        'invalid_origin',
        'bookmark_command',
        'The request origin is not allowed.',
      );
    }

    const declaredLength = Number(context.req.header('Content-Length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_COMMAND_BYTES) {
      return errorResponse(
        context,
        413,
        'request_too_large',
        'bookmark_command',
        'The Bookmark command exceeds the request limit.',
      );
    }

    const body = await readBoundedCommandBody(context.req.raw);
    if (body === null) {
      return errorResponse(
        context,
        413,
        'request_too_large',
        'bookmark_command',
        'The Bookmark command exceeds the request limit.',
      );
    }

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(body);
    } catch {
      return errorResponse(
        context,
        400,
        'invalid_command',
        'bookmark_command',
        'The Bookmark command is not valid JSON.',
      );
    }
    const parsedCommand = v.safeParse(bookmarkCommandSchema, parsedJson);
    if (!parsedCommand.success) {
      return errorResponse(
        context,
        400,
        'invalid_command',
        'bookmark_command',
        'The Bookmark command is invalid.',
      );
    }

    const result = v.parse(
      bookmarkCommandResultSchema,
      await services.executeBookmarkCommand(parsedCommand.output, context.env),
    );
    return context.json(result, result.status === 'conflict' ? 409 : 200);
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
