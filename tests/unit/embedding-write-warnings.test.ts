import { describe, expect, it } from 'vitest';
import { withWarnings } from '../../src/mcp/utils/response-formats.js';

describe('embedding write warning surface', () => {
  it('T-U-014 deduplicates embedding_deferred:<name> warnings while preserving other warnings', () => {
    const result = withWarnings(
      { status: 'created' },
      [
        'plugin_readonly_folder',
        'embedding_deferred:primary',
        'embedding_deferred:analysis',
        'embedding_deferred:primary',
      ]
    );

    expect(result).toEqual({
      status: 'created',
      warnings: ['plugin_readonly_folder', 'embedding_deferred:primary', 'embedding_deferred:analysis'],
    });
  });

  it('T-U-015 omits warnings when no write warnings exist', () => {
    expect(withWarnings({ status: 'updated' }, [])).toEqual({ status: 'updated' });
  });
});
