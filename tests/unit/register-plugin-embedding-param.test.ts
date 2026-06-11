import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  registerPluginInputSchema,
  resolvePluginEmbeddingChoice,
  validateRegisterPluginEmbeddingOverride,
} from '../../src/mcp/tools/plugins.js';

const schema = z.object(registerPluginInputSchema);

describe('register_plugin embedding_name parameter', () => {
  it('T-U-034 accepts embedding_name as string, null, or omitted', () => {
    expect(schema.parse({ schema_yaml: 'id: x', embedding_name: 'primary' }).embedding_name).toBe('primary');
    expect(schema.parse({ schema_yaml: 'id: x', embedding_name: null }).embedding_name).toBeNull();
    expect(schema.parse({ schema_yaml: 'id: x' }).embedding_name).toBeUndefined();
  });

  it('T-U-035 rejects wildcard operator override as invalid_input', () => {
    expect(validateRegisterPluginEmbeddingOverride('*')).toEqual({
      ok: false,
      message: expect.stringContaining('cannot be "*"'),
    });

    const resolved = resolvePluginEmbeddingChoice({
      manifestEmbedding: null,
      overrideEmbeddingName: '*',
      catalogEntries: [],
    });
    expect(resolved.ok).toBe(false);
    if (!resolved.ok) {
      const body = JSON.parse(resolved.error.content[0].text);
      expect(body.error).toBe('invalid_input');
      expect(body.details.field).toBe('embedding_name');
    }
  });
});
