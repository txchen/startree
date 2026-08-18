import * as v from 'valibot';

export const apiVersionSchema = v.literal(1);

export const platformStatusSchema = v.object({
  apiVersion: apiVersionSchema,
  application: v.literal('startree'),
  bookmarkRevision: v.pipe(v.number(), v.integer(), v.minValue(0)),
  version: v.string(),
});

export type PlatformStatus = v.InferOutput<typeof platformStatusSchema>;

export const apiErrorSchema = v.object({
  error: v.object({
    code: v.string(),
    operation: v.string(),
    message: v.string(),
    requestId: v.string(),
    version: v.string(),
    operationId: v.optional(v.string()),
    field: v.optional(v.string()),
    conflict: v.optional(v.string()),
    currentRevision: v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    relevantVersions: v.optional(v.record(v.string(), v.pipe(v.number(), v.integer()))),
    exceptionType: v.optional(v.string()),
    causeChain: v.optional(v.array(v.string())),
    sanitizedStack: v.optional(v.array(v.string())),
    retryAfterSeconds: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))),
  }),
});

export type ApiError = v.InferOutput<typeof apiErrorSchema>;
