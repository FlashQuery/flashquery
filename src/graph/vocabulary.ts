import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import * as yaml from 'js-yaml';
import { z } from 'zod';

export type GraphRelationDirectionality = 'directed' | 'symmetric';
export type GraphRelationDetectionMethod = 'structural' | 'classified';

export interface GraphRelationDefinition {
  name: string;
  category: GraphRelationDetectionMethod;
  directionality: GraphRelationDirectionality;
  detectionMethod: GraphRelationDetectionMethod;
  description: string;
  metadataSchema?: Record<string, unknown>;
}

const DirectionalitySchema = z.enum(['directed', 'symmetric']);
const DetectionMethodSchema = z.enum(['structural', 'classified']);

const RelationSchema = z
  .object({
    name: z.string().min(1),
    category: DetectionMethodSchema,
    directionality: DirectionalitySchema,
    detection_method: DetectionMethodSchema,
    description: z.string().min(1),
    metadata_schema: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const VocabularySchema = z
  .object({
    relations: z.array(RelationSchema).min(1),
  })
  .strict();

export const DEFAULT_GRAPH_RELATIONS: GraphRelationDefinition[] = [
  {
    name: 'contains',
    category: 'structural',
    directionality: 'directed',
    detectionMethod: 'structural',
    description: 'A parent document section contains a child section.',
  },
  {
    name: 'references',
    category: 'structural',
    directionality: 'directed',
    detectionMethod: 'structural',
    description: 'A source chunk links to or cites a target chunk.',
    metadataSchema: {
      unresolved_target: { type: 'string', optional: true },
      unresolved_anchor: { type: 'string', optional: true },
    },
  },
  {
    name: 'supports',
    category: 'classified',
    directionality: 'directed',
    detectionMethod: 'classified',
    description: 'The source chunk provides evidence for the target chunk.',
  },
  {
    name: 'contradicts',
    category: 'classified',
    directionality: 'symmetric',
    detectionMethod: 'classified',
    description: 'Two chunks make incompatible claims.',
  },
  {
    name: 'supersedes',
    category: 'classified',
    directionality: 'directed',
    detectionMethod: 'classified',
    description: 'The source chunk replaces or updates the target chunk.',
  },
  {
    name: 'duplicates',
    category: 'classified',
    directionality: 'symmetric',
    detectionMethod: 'classified',
    description: 'Two chunks express substantially the same claim.',
  },
  {
    name: 'depends_on',
    category: 'classified',
    directionality: 'directed',
    detectionMethod: 'classified',
    description: 'The source chunk requires the target chunk to be true or complete.',
  },
  {
    name: 'elaborates',
    category: 'classified',
    directionality: 'directed',
    detectionMethod: 'classified',
    description: 'The source chunk adds detail to the target chunk.',
  },
  {
    name: 'summarizes',
    category: 'classified',
    directionality: 'directed',
    detectionMethod: 'classified',
    description: 'The source chunk summarizes the target chunk.',
  },
  {
    name: 'rationale_for',
    category: 'classified',
    directionality: 'directed',
    detectionMethod: 'classified',
    description: 'The source chunk explains the reason for the target chunk.',
  },
  {
    name: 'extends',
    category: 'classified',
    directionality: 'directed',
    detectionMethod: 'classified',
    description: 'The source chunk extends the target chunk with a related claim.',
  },
  {
    name: 'resolves',
    category: 'classified',
    directionality: 'directed',
    detectionMethod: 'classified',
    description: 'The source chunk resolves a question or concern in the target chunk.',
  },
];

function relationFromYaml(raw: z.infer<typeof RelationSchema>): GraphRelationDefinition {
  return {
    name: raw.name,
    category: raw.category,
    directionality: raw.directionality,
    detectionMethod: raw.detection_method,
    description: raw.description,
    metadataSchema: raw.metadata_schema,
  };
}

export function validateGraphRelations(relations: GraphRelationDefinition[]): GraphRelationDefinition[] {
  const errors: string[] = [];
  const names = new Map<string, number>();

  for (const relation of relations) {
    names.set(relation.name, (names.get(relation.name) ?? 0) + 1);
    if (relation.name === 'semantically_similar_to') {
      errors.push("Graph relation 'semantically_similar_to' is not stored graph topology in v1");
    }
    if (relation.category !== relation.detectionMethod) {
      errors.push(
        `Graph relation '${relation.name}' category must match detection_method for v1 vocabulary`
      );
    }
  }

  for (const [name, count] of names) {
    if (count > 1) {
      errors.push(`Duplicate graph relation '${name}' appears ${count} times`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  return relations;
}

export function loadGraphVocabulary(options?: {
  vaultPath?: string;
  relationsPath?: string;
}): GraphRelationDefinition[] {
  const relationsPath = options?.relationsPath;
  if (!relationsPath) {
    return validateGraphRelations(DEFAULT_GRAPH_RELATIONS);
  }

  const resolvedPath = isAbsolute(relationsPath)
    ? relationsPath
    : join(options?.vaultPath ?? process.cwd(), relationsPath);

  if (!existsSync(resolvedPath)) {
    return validateGraphRelations(DEFAULT_GRAPH_RELATIONS);
  }

  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(resolvedPath, 'utf-8'));
  } catch (err: unknown) {
    if (err instanceof yaml.YAMLException) {
      const line = err.mark ? err.mark.line + 1 : '?';
      throw new Error(`Graph vocabulary error: Invalid YAML syntax at line ${line}: ${err.reason}`, {
        cause: err,
      });
    }
    throw err;
  }

  const result = VocabularySchema.safeParse(raw);
  if (!result.success) {
    throw new Error(
      result.error.issues
        .map((issue) => `Graph vocabulary error: ${issue.path.join('.')} ${issue.message}`)
        .join('\n')
    );
  }

  return validateGraphRelations(result.data.relations.map(relationFromYaml));
}

export function renderClassifiedGraphTypes(relations = DEFAULT_GRAPH_RELATIONS): string {
  return validateGraphRelations(relations)
    .filter((relation) => relation.category === 'classified')
    .map((relation) => {
      const symmetry =
        relation.directionality === 'symmetric' ? 'symmetric, query both directions' : 'directed';
      return `- ${relation.name}: ${relation.description} (${symmetry})`;
    })
    .join('\n');
}
