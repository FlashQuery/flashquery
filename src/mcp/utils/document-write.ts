import { FM } from '../../constants/frontmatter-fields.js';
import { documentIdentification, type ErrorEnvelope } from './response-formats.js';

export type WriteDocumentMode = 'create' | 'update';

export interface WriteDocumentInput {
  mode?: string;
  identifier?: string;
  path?: string;
  title?: string;
  content?: string;
  frontmatter?: Record<string, unknown>;
  tags?: string[];
}

const RESERVED_FRONTMATTER_FIELDS = new Set<string>([
  FM.ID,
  FM.INSTANCE,
  FM.CREATED,
  FM.STATUS,
  FM.ARCHIVED_AT,
  FM.UPDATED,
]);

export function validateWriteDocumentInput(input: WriteDocumentInput): ErrorEnvelope | null {
  if (input.mode === undefined) {
    return {
      error: 'invalid_input',
      message: 'mode is required; use mode: "create" or mode: "update"',
    };
  }

  if (input.mode !== 'create' && input.mode !== 'update') {
    return {
      error: 'invalid_input',
      message: 'mode must be "create" or "update"',
      details: { field: 'mode', value: input.mode },
    };
  }

  if (input.mode === 'create') {
    if (!input.path) {
      return {
        error: 'invalid_input',
        message: 'path is required when mode is "create"',
        details: { field: 'path' },
      };
    }
    if (!input.title) {
      return {
        error: 'invalid_input',
        message: 'title is required when mode is "create"',
        details: { field: 'title' },
      };
    }
    if (input.identifier !== undefined) {
      return {
        error: 'invalid_input',
        message: 'identifier is not allowed when mode is "create"',
        details: { field: 'identifier' },
      };
    }
  }

  if (input.mode === 'update') {
    if (!input.identifier) {
      return {
        error: 'invalid_input',
        message: 'identifier is required when mode is "update"',
        details: { field: 'identifier' },
      };
    }
    if (input.path !== undefined) {
      return {
        error: 'invalid_input',
        message: 'path is not allowed when mode is "update"',
        details: { field: 'path' },
      };
    }
    if (
      input.content === undefined &&
      input.title === undefined &&
      input.frontmatter === undefined &&
      input.tags === undefined
    ) {
      return {
        error: 'invalid_input',
        message: 'mode "update" requires at least one of content, title, frontmatter, or tags',
        details: { reason: 'no_mutable_fields' },
      };
    }
  }

  return null;
}

export function validateReservedFrontmatter(
  frontmatter: Record<string, unknown> | undefined
): ErrorEnvelope | null {
  if (!frontmatter) return null;
  for (const key of Object.keys(frontmatter)) {
    if (RESERVED_FRONTMATTER_FIELDS.has(key)) {
      return {
        error: 'invalid_input',
        message: `frontmatter field "${key}" is managed by FlashQuery and cannot be set directly`,
        details: { field: key },
      };
    }
  }
  return null;
}

export function resolveTitleFrontmatterConflict(
  title: string | undefined,
  frontmatter: Record<string, unknown> | undefined
): ErrorEnvelope | null {
  if (title === undefined || frontmatter === undefined || frontmatter[FM.TITLE] === undefined) {
    return null;
  }
  if (frontmatter[FM.TITLE] !== title) {
    return {
      error: 'invalid_input',
      message: `title conflicts with frontmatter.${FM.TITLE}`,
      details: { field: FM.TITLE },
    };
  }
  return null;
}

export function resolveTagsFrontmatterConflict(
  tags: string[] | undefined,
  frontmatter: Record<string, unknown> | undefined
): ErrorEnvelope | null {
  if (tags === undefined || frontmatter === undefined || frontmatter[FM.TAGS] === undefined) {
    return null;
  }

  const frontmatterTags = frontmatter[FM.TAGS];
  if (
    !Array.isArray(frontmatterTags) ||
    frontmatterTags.length !== tags.length ||
    frontmatterTags.some((tag, index) => tag !== tags[index])
  ) {
    return {
      error: 'invalid_input',
      message: `tags conflicts with frontmatter.${FM.TAGS}`,
      details: { field: FM.TAGS },
    };
  }

  return null;
}

export function mergeWriteDocumentFrontmatter(
  frontmatter: Record<string, unknown> | undefined,
  title: string | undefined
): Record<string, unknown> {
  const merged = { ...(frontmatter ?? {}) };
  if (title !== undefined) merged[FM.TITLE] = title;
  return merged;
}

export function buildDocumentWriteResult(input: {
  mode: WriteDocumentMode;
  identifier: string;
  title: string;
  path: string;
  fq_id: string;
  modified: string;
  chars: number;
}): ReturnType<typeof documentIdentification> & { mode: WriteDocumentMode } {
  return {
    ...documentIdentification(input),
    mode: input.mode,
  };
}
