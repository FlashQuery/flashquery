import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureSnapshot } from '../macro-framework/macro-golden-model/src/snapshot.js';
import { defaultToolRegistry } from '../macro-framework/macro-golden-model/src/mockfq.js';

const GOLDEN_DIR = join(process.cwd(), 'tests/macro-framework/macro-golden-model');

describe('macro golden model drift guard', () => {
  it('documents and examples use post-REQ-112 boolean and fq arg shapes', async () => {
    const readme = await readFile(join(GOLDEN_DIR, 'README.md'), 'utf8');
    const reviewExample = await readFile(join(GOLDEN_DIR, 'examples/03-review-readiness.fqm'), 'utf8');
    const archiveExample = await readFile(join(GOLDEN_DIR, 'examples/02-archive-drafts.fqm'), 'utf8');

    for (const [name, text] of Object.entries({ readme, reviewExample, archiveExample })) {
      expect(text, name).not.toMatch(/boolean (?:defaults|literals).*deferred/i);
      expect(text, name).not.toContain('destination_path');
      expect(text, name).not.toMatch(/\bapply_tags\(\{[^}]*\btags:/s);
    }

    expect(reviewExample).toContain('add_tags: ["#needs-work"]');
    expect(archiveExample).toContain('add_tags: ["#archived"]');
  });

  it('mock fq tools accept production document mutation argument shapes', async () => {
    const env = await captureSnapshot(
      `
moved = fq.move_document({ identifier: "doc_a", destination: "Review/doc-a.md" })
tagged = fq.apply_tags({
  targets: [{ entity_type: "document", identifier: "doc_a" }],
  add_tags: ["#reviewed"],
  remove_tags: ["#draft"]
})
renamed = fq.manage_directory({
  action: "rename",
  paths: ["Notes/Ideas"],
  destinations: ["Archive/Ideas"]
})

first_tagged = null
for t in $tagged do
  if $first_tagged == null then
    first_tagged = $t
  fi
done

first_dir = null
for d in $renamed do
  if $first_dir == null then
    first_dir = $d
  fi
done

exit {
  moved_path: $moved.path,
  added: $first_tagged.add_tags,
  removed: $first_tagged.remove_tags,
  directory_action: $first_dir.action,
  directory_destination: $first_dir.destination
}
`,
      {},
      {},
      { registry: defaultToolRegistry }
    );

    expect(env).toMatchObject({
      result_envelope: { parsed_ok: true },
      return: {
        moved_path: 'Review/doc-a.md',
        added: ['#reviewed'],
        removed: ['#draft'],
        directory_action: 'rename',
        directory_destination: 'Archive/Ideas',
      },
    });
  });
});
