import { describe, expect, it } from 'vitest';
import {
  hydrateNamespacedTemplateMessages,
  parseReferences,
  renderNamespacedTemplateVariables,
} from '../../src/llm/reference-resolver.js';

describe('namespaced template variables', () => {
  it('T-U-012 registered graph namespace replaces variables during expansion', () => {
    const content = renderNamespacedTemplateVariables('Types:\n{{graph:classified_types}}');

    expect(content).toContain('supports');
    expect(content).toContain('contradicts');
  });

  it('T-U-013 unknown namespace variable remains unresolved without throwing', () => {
    expect(renderNamespacedTemplateVariables('{{graph:missing}} {{other:value}}')).toBe(
      '{{graph:missing}} {{other:value}}'
    );
  });

  it('T-U-014 existing ref syntax remains backward compatible', () => {
    const parsed = parseReferences([{ role: 'user', content: '{{ref:Research/doc.md#Open Questions}}' }]);

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual([
      expect.objectContaining({
        identifier: 'Research/doc.md',
        section: 'Open Questions',
      }),
    ]);
  });

  it('hydrates graph namespace variables across message arrays', () => {
    const messages = hydrateNamespacedTemplateMessages([
      { role: 'user', content: 'Use {{graph:classified_types}}' },
    ]);

    expect(messages[0].content).toContain('depends_on');
  });
});
