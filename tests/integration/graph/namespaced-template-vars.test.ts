import { describe, expect, it } from 'vitest';
import {
  createGraphNamespaceProviders,
  hydrateNamespacedTemplateMessages,
  renderNamespacedTemplateVariables,
} from '../../../src/llm/reference-resolver.js';

describe('graph namespaced template variables', () => {
  it('T-I-001 expands loaded graph vocabulary through production namespace provider at template expansion time', () => {
    const first = renderNamespacedTemplateVariables(
      '{{graph:classified_types}}',
      createGraphNamespaceProviders({
        graph: {
          enabled: true,
          embeddingName: 'test',
          resolvedRelations: [
            {
              name: 'first_relation',
              category: 'classified',
              directionality: 'directed',
              detectionMethod: 'classified',
              description: 'First loaded vocabulary.',
            },
          ],
        },
      } as never)
    );
    const second = renderNamespacedTemplateVariables(
      '{{graph:classified_types}}',
      createGraphNamespaceProviders({
        graph: {
          enabled: true,
          embeddingName: 'test',
          resolvedRelations: [
            {
              name: 'second_relation',
              category: 'classified',
              directionality: 'symmetric',
              detectionMethod: 'classified',
              description: 'Second loaded vocabulary.',
            },
          ],
        },
      } as never)
    );

    expect(first).toContain('first_relation');
    expect(first).not.toContain('second_relation');
    expect(second).toContain('second_relation');
    expect(second).not.toContain('first_relation');
  });

  it('preserves unknown namespace tokens in message expansion', () => {
    const messages = hydrateNamespacedTemplateMessages([{ role: 'user', content: '{{unknown:value}}' }]);

    expect(messages).toEqual([{ role: 'user', content: '{{unknown:value}}' }]);
  });
});
