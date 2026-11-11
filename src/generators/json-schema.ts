/**
 * zod schema → JSON Schema
 */
import { z } from 'zod';

export type JsonSchema = Record<string, unknown>;

export function toJsonSchema(schema: z.ZodTypeAny, io: 'input' | 'output' = 'input'): JsonSchema {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12', io, unrepresentable: 'any' }) as JsonSchema;
  delete json.$schema;
  if (typeof json.$ref === 'string' && json.$defs && typeof json.$defs === 'object') {
    const defs = json.$defs as Record<string, JsonSchema>;
    const name = json.$ref.split('/').pop() ?? '';
    const target = defs[name];
    if (target) {
      const { $ref: _ref, $defs: _defs, ...rest } = json;
      return { ...target, ...rest, $defs: defs };
    }
  }
  return json;
}
