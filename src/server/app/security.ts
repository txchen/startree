import type { MiddlewareHandler } from 'hono';

import type { AppEnvironment, CoreBindings } from './types';

const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self'",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
].join('; ');

export const securityHeaders =
  <Bindings extends CoreBindings>(): MiddlewareHandler<AppEnvironment<Bindings>> =>
  async (context, next) => {
    await next();
    context.header('Content-Security-Policy', contentSecurityPolicy);
    context.header('Cross-Origin-Opener-Policy', 'same-origin');
    context.header('Referrer-Policy', 'no-referrer');
    context.header('X-Content-Type-Options', 'nosniff');
    context.header('X-Frame-Options', 'DENY');
    context.header('Permissions-Policy', 'camera=(), geolocation=(), microphone=()');

    if (context.req.path.startsWith('/api/')) {
      context.header('Cache-Control', 'private, no-store');
    }
  };
