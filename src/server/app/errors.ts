import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

import type { ApiError } from '../../shared/platform/contracts';
import type { AppEnvironment, CoreBindings } from './types';

export const requestIdFor = <Bindings extends CoreBindings>(
  context: Context<AppEnvironment<Bindings>>,
): string => context.req.header('cf-ray') ?? crypto.randomUUID();

export const sanitizedExceptionDiagnostics = (value: unknown) => {
  const causeChain: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = value;
  while (current instanceof Error && causeChain.length < 5 && !seen.has(current)) {
    seen.add(current);
    causeChain.push(current.name || 'Error');
    current = current.cause;
  }

  const exceptionType = value instanceof Error ? value.name || 'Error' : typeof value;
  const sanitizedStack =
    value instanceof Error
      ? (value.stack ?? '')
          .split('\n')
          .slice(1)
          .map((line) => /^\s*at\s+(?:async\s+)?([^\s(]+)/.exec(line)?.[1])
          .filter((frame): frame is string => Boolean(frame))
          .map((frame) => frame.replaceAll(/[^A-Za-z0-9_.$<>-]/g, '').slice(0, 120))
          .filter(Boolean)
          .slice(0, 12)
      : [];

  return {
    exceptionType,
    causeChain: causeChain.length ? causeChain : [exceptionType],
    sanitizedStack,
  };
};

export const errorResponse = <Bindings extends CoreBindings>(
  context: Context<AppEnvironment<Bindings>>,
  status: ContentfulStatusCode,
  code: string,
  operation: string,
  message: string,
  details: Partial<ApiError['error']> = {},
) => {
  const body: ApiError = {
    error: {
      code,
      operation,
      message,
      requestId: requestIdFor(context),
      version: context.env.APP_VERSION,
      ...details,
    },
  };

  return context.json(body, status);
};
