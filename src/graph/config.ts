import type { FlashQueryConfig } from '../config/types.js';

export interface GraphRuntimeConfig {
  enabled: boolean;
  embeddingName?: string;
  classificationPurpose?: string;
  classificationModel?: string;
  similarityMode?: 'threshold' | 'percentile';
  similarityThreshold?: number;
  similarityPercentile?: number;
  maxClassificationJobsPerSave?: number;
  maxEdgeAttempts?: number;
  relations?: string;
  prompts?: string;
  promptOverrides?: Record<string, unknown>;
}

export function graphDisabledConfig(): GraphRuntimeConfig {
  return { enabled: false };
}

export function validateGraphConfig(config: {
  graph?: GraphRuntimeConfig;
  embeddings?: FlashQueryConfig['embeddings'];
  llm?: FlashQueryConfig['llm'];
}): void {
  const graph = config.graph;
  if (!graph?.enabled) return;

  const errors: string[] = [];
  const embeddings = config.embeddings ?? [];
  const embeddingName = graph.embeddingName;

  if (!embeddingName) {
    errors.push('Config error: graph.embedding_name is required when graph.enabled is true');
  } else if (!embeddings.some((entry) => entry.name === embeddingName)) {
    errors.push(
      `Config error: graph.embedding_name '${embeddingName}' references unknown embedding — defined embeddings: [${embeddings.map((entry) => entry.name).join(', ') || '(none)'}]`
    );
  }

  if (graph.classificationPurpose && graph.classificationModel) {
    errors.push(
      'Config error: graph.classification_purpose and graph.classification_model are mutually exclusive'
    );
  }

  if (graph.classificationPurpose) {
    const purposes = config.llm?.purposes ?? [];
    if (!purposes.some((purpose) => purpose.name === graph.classificationPurpose)) {
      errors.push(
        `Config error: graph.classification_purpose '${graph.classificationPurpose}' references unknown llm purpose`
      );
    }
  }

  if (graph.classificationModel) {
    const models = config.llm?.models ?? [];
    if (!models.some((model) => model.name === graph.classificationModel)) {
      errors.push(
        `Config error: graph.classification_model '${graph.classificationModel}' references unknown llm model`
      );
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }
}
