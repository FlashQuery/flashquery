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
      error?: unknown;
      summary: string;
    };

export function parseLlmJson<T>(raw: string, schema: z.ZodType<T>): LlmJsonParseResult<T> {
  let repairedText = raw;
  let repaired = false;
  let repairError: unknown;

  try {
    repairedText = jsonrepair(raw);
    repaired = repairedText !== raw;
  } catch (error: unknown) {
    repairError = error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(repairedText) as unknown;
  } catch (parseError: unknown) {
    return {
      ok: false,
      raw,
      repaired,
      failure: 'syntax',
      error: repairError ?? parseError,
      summary: summarizeSyntaxFailure(repairError ?? parseError),
    };
  }

  const validated = schema.safeParse(parsed);

  if (!validated.success) {
    const issues = validated.error.issues.map((issue) => ({
      path: issue.path.map((segment) => (typeof segment === 'symbol' ? String(segment) : segment)),
      message: issue.message,
    }));

    return {
      ok: false,
      raw,
      repaired,
      failure: 'schema',
      error: validated.error,
      issues,
      summary: summarizeLlmJsonIssues(issues),
    };
  }

  return {
    ok: true,
    data: validated.data,
    raw,
    repaired,
  };
}

export function summarizeLlmJsonIssues(issues: LlmJsonIssue[]): string {
  if (issues.length === 0) return 'JSON did not match the expected schema.';

  const visibleIssues = issues.slice(0, 3).map((issue) => {
    const path = issue.path.length === 0 ? '<root>' : issue.path.join('.');
    return `${path}: ${issue.message}`;
  });
  const suffix = issues.length > visibleIssues.length ? `; +${issues.length - visibleIssues.length} more` : '';
  return `JSON schema validation failed: ${visibleIssues.join('; ')}${suffix}`;
}

function summarizeSyntaxFailure(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `JSON syntax could not be repaired or parsed: ${message}`;
}
