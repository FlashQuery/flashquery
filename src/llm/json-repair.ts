import { jsonrepair } from 'jsonrepair';
import type { z } from 'zod';

export interface LlmJsonIssue {
  path: Array<string | number>;
  message: string;
}

export type LlmJsonParseResult<T> =
  | {
      ok: true;
      data: T;
      raw: string;
      repaired: boolean;
    }
  | {
      ok: false;
      raw: string;
      repaired: boolean;
      failure: 'syntax' | 'schema';
      issues?: LlmJsonIssue[];
      summary: string;
    };

export function parseLlmJson<T>(raw: string, schema: z.ZodType<T>): LlmJsonParseResult<T> {
  const repairedText = jsonrepair(raw);
  const parsed = JSON.parse(repairedText) as unknown;
  const validated = schema.safeParse(parsed);

  if (!validated.success) {
    return {
      ok: false,
      raw,
      repaired: repairedText !== raw,
      failure: 'schema',
      issues: validated.error.issues.map((issue) => ({
        path: issue.path,
        message: issue.message,
      })),
      summary: 'JSON did not match the expected schema.',
    };
  }

  return {
    ok: true,
    data: validated.data,
    raw,
    repaired: repairedText !== raw,
  };
}
