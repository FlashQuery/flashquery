import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  documentIdentification,
  jsonExpectedError,
  jsonToolResult,
  type ErrorEnvelope,
} from '../../src/mcp/utils/response-formats.js';

describe('copy_document JSON output contract', () => {
  it('returns parseable JSON with document identification and body char size for the new copy', () => {
    const sourceFqId = 'source-uuid';
    const copyFqId = 'copy-uuid';
    const body = 'Copied body text.';

    const result = jsonToolResult(documentIdentification({
      identifier: 'Copies/copied.md',
      title: 'Copied Document',
      path: 'Copies/copied.md',
      fq_id: copyFqId,
      modified: '2026-05-12T00:00:00.000Z',
      chars: body.length,
    }));

    const payload = JSON.parse(result.content[0]!.text) as Record<string, unknown>;

    expect(payload).toEqual({
      identifier: 'Copies/copied.md',
      title: 'Copied Document',
      path: 'Copies/copied.md',
      fq_id: copyFqId,
      modified: '2026-05-12T00:00:00.000Z',
      size: { chars: body.length },
    });
    expect((payload.size as { chars: number }).chars).toBe(body.length);
    expect(payload.fq_id).not.toBe(sourceFqId);
  });

  it('returns canonical conflict envelopes with isError:false for destination path conflicts', () => {
    const result = jsonExpectedError({
      error: 'conflict',
      message: 'A file already exists at destination.',
      identifier: 'Copies/existing.md',
      details: { reason: 'path_exists' },
    });

    const payload = JSON.parse(result.content[0]!.text) as ErrorEnvelope;

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'conflict',
      identifier: 'Copies/existing.md',
      details: { reason: 'path_exists' },
    });
  });

  it('keeps copy_document single-target by rejecting array-like source identifiers', () => {
    const result = jsonExpectedError({
      error: 'invalid_input',
      message: 'copy_document accepts one source identifier; array input is not supported.',
      details: { reason: 'single_target_only' },
    });

    const payload = JSON.parse(result.content[0]!.text) as ErrorEnvelope;

    expect(result.isError).toBe(false);
    expect(payload).toMatchObject({
      error: 'invalid_input',
      details: { reason: 'single_target_only' },
    });
  });

  it('represents lock timeout and tag validation as expected JSON errors', () => {
    const lock = jsonExpectedError({
      error: 'conflict',
      message: 'Write lock timeout: another instance is writing to documents. Retry in a few seconds.',
      identifier: 'Source.md',
      details: { reason: 'lock_timeout' },
    });
    const tags = jsonExpectedError({
      error: 'invalid_input',
      message: 'Tag validation failed - invalid tag',
      identifier: 'Source.md',
      details: { field: 'tags', errors: ['invalid tag'] },
    });

    expect(lock.isError).toBe(false);
    expect(JSON.parse(lock.content[0]!.text)).toMatchObject({
      error: 'conflict',
      details: { reason: 'lock_timeout' },
    });
    expect(tags.isError).toBe(false);
    expect(JSON.parse(tags.content[0]!.text)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'tags' },
    });
  });

  it('uses JSON runtime envelopes for unexpected copy_document failures', () => {
    const copySection = readFileSync('src/mcp/tools/documents/copy.ts', 'utf8');

    expect(copySection).toContain("details: { reason: 'lock_timeout' }");
    expect(copySection).toContain("details: { field: 'tags', errors: [...validation.errors] }");
    expect(copySection).toContain('return jsonRuntimeError({ message: `Error copying document: ${msg}`, identifier });');
    expect(copySection).not.toContain('Tag validation failed - ${messages.join');
    expect(copySection).not.toContain('text: `Error: ${msg}`');
  });

  it('uses documentIdentification in copy_document and does not emit legacy key-value Title output', () => {
    const copySection = readFileSync('src/mcp/tools/documents/copy.ts', 'utf8');

    expect(copySection).toContain('documentIdentification');
    expect(copySection).toContain('validateVaultPath(config.instance.vault.path, requestedCopyPath)');
    expect(copySection).toContain('Supabase copy insert failed');
    expect(copySection).not.toContain("formatKeyValueEntry('Title', copyTitle)");
    expect(copySection).toContain('path_exists');
  });
});
