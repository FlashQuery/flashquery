import { describe, expect, it } from 'vitest';
import {
  hydrateNamespacedTemplateMessages,
  renderNamespacedTemplateVariables,
} from '../../../src/llm/reference-resolver.js';

describe('graph namespaced template variables', () => {
  it('T-I-001 expands graph vocabulary through namespace provider at template expansion time', () => {
    const first = renderNamespacedTemplateVariables('{{graph:classified_types}}', {
      graph: (variable) => (variable === 'classified_types' ? 'first-vocabulary' : undefined),
    });
    const second = renderNamespacedTemplateVariables('{{graph:classified_types}}', {
      graph: (variable) => (variable === 'classified_types' ? 'second-vocabulary' : undefined),
    });

    expect(first).toBe('first-vocabulary');
    expect(second).toBe('second-vocabulary');
  });

  it('preserves unknown namespace tokens in message expansion', () => {
    const messages = hydrateNamespacedTemplateMessages([{ role: 'user', content: '{{unknown:value}}' }]);

    expect(messages).toEqual([{ role: 'user', content: '{{unknown:value}}' }]);
  });
});
