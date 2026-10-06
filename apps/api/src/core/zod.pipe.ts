import { PipeTransform } from '@nestjs/common';
import { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors';

/** Validates a request body against a zod schema from @innovcare/shared. */
export class ZodPipe<T extends ZodTypeAny> implements PipeTransform<unknown, z.infer<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.infer<T> {
    return parseOr400(this.schema, value);
  }
}

export function parseOr400<T extends ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.');
    throw badRequest('VALIDATION_ERROR', first ? `${path ? path + ' : ' : ''}${first.message}` : 'Données invalides', result.error.flatten());
  }
  return result.data;
}
