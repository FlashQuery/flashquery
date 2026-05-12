import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  documentIdentification,
  jsonExpectedError,
  jsonToolResult,
  withWarnings,
  type ErrorEnvelope,
} from '../../src/mcp/utils/response-formats.js';

describe('move_document JSON output contract', () => {
  it('returns parseable JSON with destination path, stable fq_id, and body char size', () => {
    const sourceFqId = 'stable-doc-id';
    const body = 'Moved document body.';

    const result = jsonToolResult(documentIdentification({
      identifier: 'Moved/Renamed.md',
      title: 'Renamed',
      path: 'Moved/Renamed.md',
      fq_id: sourceFqId,
      modified: '2026-05-12T00:00:00.000Z',
      chars: body.length,
    }));

    const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(payload).toMatchObject({
      identifier: 'Moved/Renamed.md',
      path: 'Moved/Renamed.md',
      fq_id: sourceFqId,
    });
    expect((payload.size as { chars: number }).chars, 'size.chars').toBe(body.length);
  });

  it('normalizes extensionless destination paths to the source extension in the returned path', () => {
    const sourcePath = 'Source/Original.md';
    const extensionlessDestination = 'Moved/Renamed';
    const normalizedDestination = `${extensionlessDestination}.md`;

    expect(sourcePath.endsWith('.md')).toBe(true);
    expect(normalizedDestination).toBe('Moved/Renamed.md');
  });

  it('returns canonical conflict envelopes with isError:false for destination path conflicts', () => {
    const result = jsonExpectedError({
      error: 'conflict',
      message: 'A file already exists at destination.',
      identifier: 'Moved/existing.md',
      details: { reason: 'path_exists' },
    });

    const payload = JSON.parse(result.content[0]!.text) as ErrorEnvelope;

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'conflict',
      identifier: 'Moved/existing.md',
      details: { reason: 'path_exists' },
    });
  });

  it('represents plugin ownership as warning codes rather than appended prose', () => {
    const result = jsonToolResult(withWarnings(
      documentIdentification({
        identifier: 'Moved/PluginOwned.md',
        title: 'Plugin Owned',
        path: 'Moved/PluginOwned.md',
        fq_id: 'plugin-owned-id',
        modified: '2026-05-12T00:00:00.000Z',
        chars: 11,
      }),
      ['plugin_ownership_path_expectation']
    ));

    const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(payload.warnings).toEqual(['plugin_ownership_path_expectation']);
  });

  it('uses JSON documentIdentification in move_document and removes old prose response text', () => {
    const source = readFileSync('src/mcp/tools/documents.ts', 'utf8');
    const moveSection = source.slice(source.indexOf("'move_document'"));

    expect(moveSection).toContain('documentIdentification');
    expect(moveSection).toContain('plugin_ownership_path_expectation');
    expect(moveSection).toContain('path_exists');
    expect(moveSection).not.toContain('Document moved successfully');
    expect(moveSection).not.toContain('References to this document');
  });
});
