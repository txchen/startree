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
  }),
});

export type ApiError = v.InferOutput<typeof apiErrorSchema>;
