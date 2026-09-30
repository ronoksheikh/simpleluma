import type { z } from 'zod';
import { badRequest } from './errors.js';

/** Parse `data` with `schema`, turning failures into a 400 with a readable message. */
export function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw badRequest(issue ? `${issue.path.join('.') || 'body'}: ${issue.message}` : 'Invalid request');
  }
  return result.data;
}
