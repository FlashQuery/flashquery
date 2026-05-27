import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { HAS_SUPABASE } from '../helpers/test-env.js';
import {
  createPhase155Harness,
  parseToolJson,
  writeDocument,
  type Phase155Harness,
} from './vault-write-coherency-phase155-helpers.js';

type RegionPayload = {
  error?: string;
  details?: { reason?: string };
  targeted_region?: Record<string, unknown>;
  version_token?: string;
};

function expectVersionMismatchRegion(payload: RegionPayload): Record<string, unknown> {
  expect(payload).toMatchObject({ error: 'conflict', details: { reason: 'version_mismatch' } });
  expect(payload.version_token).toMatch(/^[a-f0-9]{64}$/);
  expect(payload.targeted_region).toEqual(expect.any(Object));
  return payload.targeted_region ?? {};
}

describe.skipIf(!HAS_SUPABASE)('REQ-015 refused-write conflict envelope integration', () => {
  let harness: Phase155Harness;

  beforeAll(async () => {
    harness = await createPhase155Harness('fqc-refused-write-envelope-');
    harness.vaultPath = await realpath(harness.vaultPath);
    harness.config.instance.vault.path = harness.vaultPath;
  }, 60_000);

  afterAll(async () => {
    await harness?.cleanup();
  });

  it('T-I-029 conflicts include per-tool targeted_region for section, frontmatter, whole-document, anchor/end, and destructive cases', async () => {
    await writeDocument(
      harness.handlers,
      'phase162/refused-regions.md',
      'Refused Regions',
      '# Refused Regions\n\n## Target\nCurrent target.\n\n## Other\nOther body.'
    );
    await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase162/refused-regions.md',
      content: '# Refused Regions\n\n## Target\nChanged target.\n\n## Other\nOther body.',
    });

    const replacePayload = parseToolJson<RegionPayload>(await harness.handlers.replace_doc_section({
        identifier: 'phase162/refused-regions.md',
        heading: 'Target',
        heading_match: 'exact',
        content: 'stale section',
        expected_version: '2'.repeat(64),
      }));
    const replaceRegion = expectVersionMismatchRegion(replacePayload);
    expect(replaceRegion).toMatchObject({
      kind: 'section',
      heading: 'Target',
      body: expect.stringContaining('Changed target.'),
    });

    const tagsPayload = parseToolJson<RegionPayload>(await harness.handlers.apply_tags({
        identifiers: 'phase162/refused-regions.md',
        add_tags: ['stale'],
        expected_version: '2'.repeat(64),
      }));
    const tagsRegion = expectVersionMismatchRegion(tagsPayload);
    expect(tagsRegion).toMatchObject({
      kind: 'frontmatter',
      frontmatter: expect.objectContaining({ fq_title: 'Refused Regions' }),
    });

    const linkPayload = parseToolJson<RegionPayload>(await harness.handlers.insert_doc_link({
      identifiers: 'phase162/refused-regions.md',
      target_identifier: 'phase162/refused-regions.md',
      property: 'related',
      expected_version: '2'.repeat(64),
    }));
    const linkRegion = expectVersionMismatchRegion(linkPayload);
    expect(linkRegion).toMatchObject({
      kind: 'frontmatter',
      frontmatter: expect.objectContaining({ fq_title: 'Refused Regions' }),
    });

    const writePayload = parseToolJson<RegionPayload>(await harness.handlers.write_document({
        mode: 'update',
        identifier: 'phase162/refused-regions.md',
        content: 'stale whole document',
        expected_version: '2'.repeat(64),
      }));
    const writeRegion = expectVersionMismatchRegion(writePayload);
    expect(writeRegion).toMatchObject({
      type: 'document',
      path: 'phase162/refused-regions.md',
      content: expect.stringContaining('Changed target.'),
    });

    const anchorPayload = parseToolJson<RegionPayload>(await harness.handlers.insert_in_doc({
        identifier: 'phase162/refused-regions.md',
        position: 'after_heading',
        heading: 'Target',
        heading_match: 'exact',
        content: 'stale insert',
        expected_version: '2'.repeat(64),
      }));
    const anchorRegion = expectVersionMismatchRegion(anchorPayload);
    expect(anchorRegion).toMatchObject({
      kind: 'section',
      heading: 'Target',
      body: expect.stringContaining('Changed target.'),
    });

    const endPayload = parseToolJson<RegionPayload>(await harness.handlers.insert_in_doc({
      identifier: 'phase162/refused-regions.md',
      position: 'end',
      content: 'stale append',
      expected_version: '2'.repeat(64),
    }));
    const endRegion = expectVersionMismatchRegion(endPayload);
    expect(endRegion).toMatchObject({ kind: 'document_end', position: 'end' });

    const archivePayload = parseToolJson<RegionPayload>(await harness.handlers.archive_document({
        identifiers: 'phase162/refused-regions.md',
        expected_version: '2'.repeat(64),
      }));
    expect(expectVersionMismatchRegion(archivePayload)).toMatchObject({
      kind: 'frontmatter',
      frontmatter: expect.objectContaining({ fq_title: 'Refused Regions' }),
    });

    const copyPayload = parseToolJson<RegionPayload>(await harness.handlers.copy_document({
      identifier: 'phase162/refused-regions.md',
      destination: 'phase162/refused-regions-copy.md',
      expected_version: '2'.repeat(64),
    }));
    expect(expectVersionMismatchRegion(copyPayload)).toMatchObject({ type: 'document' });

    const movePayload = parseToolJson<RegionPayload>(await harness.handlers.move_document({
      identifier: 'phase162/refused-regions.md',
      destination: 'phase162/refused-regions-moved.md',
      expected_version: '2'.repeat(64),
    }));
    expect(expectVersionMismatchRegion(movePayload)).toMatchObject({ type: 'document' });
  });

  it('T-I-030 removed target section returns targeted_region.not_found true', async () => {
    await writeDocument(
      harness.handlers,
      'phase162/refused-not-found.md',
      'Refused Not Found',
      '# Refused Not Found\n\n## Deleted\nSoon gone.\n'
    );
    await harness.handlers.write_document({
      mode: 'update',
      identifier: 'phase162/refused-not-found.md',
      content: '# Refused Not Found\n\nThe target section was removed.\n',
    });

    const result = await harness.handlers.replace_doc_section({
      identifier: 'phase162/refused-not-found.md',
      heading: 'Deleted',
      heading_match: 'exact',
      content: 'stale replacement',
      expected_version: '3'.repeat(64),
    });

    expect(parseToolJson<RegionPayload>(result)).toMatchObject({
      error: 'conflict',
      details: { reason: 'version_mismatch' },
      targeted_region: { not_found: true },
    });
  });

  it('T-I-031 conflict region representation is byte-identical to get_document for that region', async () => {
    await writeDocument(
      harness.handlers,
      'phase162/refused-byte-identical.md',
      'Refused Byte Identical',
      '# Refused Byte Identical\n\n## Stable\nCurrent bytes.\n\n## Tail\nTail bytes.'
    );
    const getRegion = parseToolJson<{ body: string }>(await harness.handlers.get_document({
      identifiers: 'phase162/refused-byte-identical.md',
      include: ['body'],
      sections: ['Stable'],
    }));
    const before = await readFile(join(harness.vaultPath, 'phase162/refused-byte-identical.md'), 'utf-8');
    expect(before).toContain(getRegion.body);

    const conflict = parseToolJson<RegionPayload>(await harness.handlers.replace_doc_section({
      identifier: 'phase162/refused-byte-identical.md',
      heading: 'Stable',
      heading_match: 'exact',
      content: 'stale bytes',
      expected_version: '4'.repeat(64),
    }));

    expectVersionMismatchRegion(conflict);
    expect(conflict.targeted_region?.body).toBe(getRegion.body);
  });
});
