/**
 * Synthetic Vault Generator
 *
 * Generates realistic synthetic vault structures at scale for benchmarking
 * and performance testing. Creates 1000+ document vaults with configurable
 * folder distribution, file sizes, and discovery states.
 *
 * Usage:
 *   const meta = await createSyntheticVault({ vaultPath: '/tmp/bench-vault' });
 *   // → { vaultPath, documentCount, pluginCount, generationTime }
 *
 *   // Or use the builder API for custom distributions:
 *   const { vaultPath, documents } = await new SyntheticVaultBuilder('/tmp/vault')
 *     .withDocumentCount(1000)
 *     .withDiscoveryMix(50, 10)
 *     .build();
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { v4 as uuidv4 } from 'uuid';

// ─────────────────────────────────────────────────────────────────────────────
// Types & Interfaces
// ─────────────────────────────────────────────────────────────────────────────

export interface FolderSpec {
  path: string;
  documentCount: number;
}

export interface PluginManifestSpec {
  plugin_id: string;
  folders: string[]; // vault-relative folder paths this plugin claims
  type: string;      // document type id
}

export interface DocumentMetadata {
  path: string;       // vault-relative path
  fqcId: string;      // assigned UUID
  state: 'discovered' | 'undiscovered' | 'modified';
  plugin_id?: string; // set if already discovered (frontmatter ownership)
  sizeKb: number;
}

export interface VaultMetadata {
  vaultPath: string;
  documentCount: number;
  pluginCount: number;
  generationTime: number; // ms
  documents: DocumentMetadata[];
}

export interface VaultGenerationOptions {
  vaultPath: string;
  documentCount?: number;
  percentAlreadyDiscovered?: number; // default 50
  percentModified?: number;          // default 10 (of undiscovered docs)
  plugins?: PluginManifestSpec[];
}

// ─────────────────────────────────────────────────────────────────────────────
// SyntheticVaultBuilder — Chainable Builder API
// ─────────────────────────────────────────────────────────────────────────────

export class SyntheticVaultBuilder {
  private _documentCount = 1000;
  private _minSizeKb = 5;
  private _maxSizeKb = 50;
  private _percentAlreadyDiscovered = 50;
  private _percentModified = 10;
  private _plugins: PluginManifestSpec[] = [];
  private _folders: FolderSpec[] = [];

  constructor(private basePath: string) {}

  withDocumentCount(count: number): this {
    this._documentCount = count;
    return this;
  }

  withFolderStructure(folders: FolderSpec[]): this {
    this._folders = folders;
    return this;
  }

  withFileSizes(min: number, max: number): this {
    this._minSizeKb = min;
    this._maxSizeKb = max;
    return this;
  }

  withDiscoveryMix(percentAlreadyDiscovered: number, percentModified: number): this {
    this._percentAlreadyDiscovered = percentAlreadyDiscovered;
    this._percentModified = percentModified;
    return this;
  }

  withPlugins(plugins: PluginManifestSpec[]): this {
    this._plugins = plugins;
    return this;
  }

  async build(): Promise<{ vaultPath: string; documents: DocumentMetadata[] }> {
    await mkdir(this.basePath, { recursive: true });

    // Build folder distribution
    const folders = this._folders.length > 0
      ? this._folders
      : buildDefaultFolderDistribution(this._documentCount);

    // Assign documents to folders
    const documents: DocumentMetadata[] = [];
    let docIndex = 0;

    for (const folder of folders) {
      await mkdir(join(this.basePath, folder.path), { recursive: true });

      for (let i = 0; i < folder.documentCount; i++) {
        const title = `Document ${docIndex + 1}`;
        const slug = slugify(title, docIndex);
        const relativePath = `${folder.path}/${slug}.md`;
        const fqcId = uuidv4();

        // Determine discovery state
        const rand = Math.random() * 100;
        let state: DocumentMetadata['state'] = 'undiscovered';
        let plugin_id: string | undefined;

        if (rand < this._percentAlreadyDiscovered) {
          state = 'discovered';
          plugin_id = findPluginForFolder(folder.path, this._plugins);
        } else if (rand < this._percentAlreadyDiscovered + this._percentModified) {
          state = 'modified';
        }

        // Determine file size (realistic distribution)
        const sizeKb = pickFileSize(this._minSizeKb, this._maxSizeKb);

        // Generate and write the file
        const content = generateRealisticMarkdown(title, folder.path, sizeKb, {
          fqcId,
          plugin_id,
          isDiscovered: state === 'discovered',
        });

        const absolutePath = join(this.basePath, relativePath);
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content, 'utf-8');

        documents.push({ path: relativePath, fqcId, state, plugin_id, sizeKb });
        docIndex++;
      }
    }

    return { vaultPath: this.basePath, documents };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// createSyntheticVault() — Quick helper for standard benchmark vault
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Quick helper for creating the standard benchmark vault:
 * - 1000 documents across CRM, Notes, Tasks folders
 * - 3 plugins (crm, notes, tasks)
 * - 50% already discovered, 40% undiscovered, 10% modified
 *
 * @returns VaultMetadata with vault path, counts, and generation time
 */
export async function createSyntheticVault(options: VaultGenerationOptions): Promise<VaultMetadata> {
  const start = performance.now();

  const plugins: PluginManifestSpec[] = options.plugins ?? [
    { plugin_id: 'crm',   folders: ['CRM/Contacts', 'CRM/Companies', 'CRM/Tasks'], type: 'contact'  },
    { plugin_id: 'notes', folders: ['Notes/Projects', 'Notes/Daily', 'Notes/References'], type: 'note' },
    { plugin_id: 'tasks', folders: ['Tasks/Active', 'Tasks/Archived'], type: 'task' },
  ];

  const builder = new SyntheticVaultBuilder(options.vaultPath)
    .withDocumentCount(options.documentCount ?? 1000)
    .withDiscoveryMix(
      options.percentAlreadyDiscovered ?? 50,
      options.percentModified ?? 10
    )
    .withPlugins(plugins);

  const { vaultPath, documents } = await builder.build();

  return {
    vaultPath,
    documentCount: documents.length,
    pluginCount: plugins.length,
    generationTime: performance.now() - start,
    documents,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateRealisticMarkdown() — Markdown content at target size
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate realistic markdown content of approximately the specified size.
 * Includes YAML frontmatter (fqc_id, title, ownership for discovered docs),
 * multiple sections, and padded content to reach target file size.
 */
export function generateRealisticMarkdown(
  title: string,
  type: string,
  sizeKb: number,
  options?: {
    fqcId?: string;
    plugin_id?: string;
    isDiscovered?: boolean;
  }
): string {
  const fqcId = options?.fqcId ?? uuidv4();
  const isDiscovered = options?.isDiscovered ?? false;
  const plugin_id = options?.plugin_id;

  // Build frontmatter
  const frontmatterLines = [
    '---',
    `fqc_id: ${fqcId}`,
    `title: "${title}"`,
    `created: "${new Date().toISOString()}"`,
    `updated: "${new Date().toISOString()}"`,
  ];

  if (isDiscovered && plugin_id) {
    frontmatterLines.push(`ownership: ${plugin_id}/document`);
    frontmatterLines.push(`discovery_status: complete`);
  }

  frontmatterLines.push('---', '');

  const frontmatter = frontmatterLines.join('\n');

  // Build structured body (realistic document)
  const body = buildDocumentBody(title, type);

  // Combine and pad to target size
  const combined = frontmatter + body;
  const targetBytes = sizeKb * 1024;

  if (combined.length >= targetBytes) {
    return combined;
  }

  // Pad with lorem ipsum blocks to reach target size
  const padding = generateLoremPadding(targetBytes - combined.length);
  return combined + padding;
}

// ─────────────────────────────────────────────────────────────────────────────
// injectDocumentModifications() — Modify documents for "changed" state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Modify specified documents by updating their content.
 * Used to create the "10% modified" portion of the benchmark vault.
 * Adds new tags and updates the title field.
 */
export async function injectDocumentModifications(
  vaultPath: string,
  documentPaths: string[],
  changes: { title?: string; addTags?: string[] }
): Promise<void> {
  for (const relativePath of documentPaths) {
    const absolutePath = join(vaultPath, relativePath);

    try {
      const { readFile } = await import('node:fs/promises');
      const raw = await readFile(absolutePath, 'utf-8');

      let modified = raw;

      if (changes.title) {
        modified = modified.replace(/^title: ".*"$/m, `title: "${changes.title}"`);
      }

      if (changes.addTags && changes.addTags.length > 0) {
        const tagLine = `tags: [${changes.addTags.map((t) => `"${t}"`).join(', ')}]`;
        modified = modified.replace(/^---\n/, `---\n${tagLine}\n`);
      }

      // Update the updated timestamp to simulate a real modification
      modified = modified.replace(
        /^updated: ".*"$/m,
        `updated: "${new Date().toISOString()}"`
      );

      await writeFile(absolutePath, modified, 'utf-8');
    } catch {
      // Skip files that can't be read/written (log would be noisy in benchmarks)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build default folder distribution for 1000 document benchmark vault.
 * Matches the plan's synthetic vault structure.
 */
function buildDefaultFolderDistribution(totalDocs: number): FolderSpec[] {
  // Scale proportionally to total doc count
  const scale = totalDocs / 1000;

  return [
    { path: 'CRM/Contacts',        documentCount: Math.round(200 * scale) },
    { path: 'CRM/Companies',       documentCount: Math.round(150 * scale) },
    { path: 'CRM/Tasks',           documentCount: Math.round(100 * scale) },
    { path: 'Notes/Projects',      documentCount: Math.round(200 * scale) },
    { path: 'Notes/Daily',         documentCount: Math.round(150 * scale) },
    { path: 'Notes/References',    documentCount: Math.round(100 * scale) },
    { path: 'Tasks/Active',        documentCount: Math.round(200 * scale) },
    { path: 'Tasks/Archived',      documentCount: Math.round(100 * scale) },
  ];
}

/**
 * Find the plugin_id that claims the given folder path.
 * Returns the first match or 'unknown' if no match found.
 */
function findPluginForFolder(folderPath: string, plugins: PluginManifestSpec[]): string | undefined {
  for (const plugin of plugins) {
    for (const folder of plugin.folders) {
      if (folderPath.toLowerCase().startsWith(folder.toLowerCase())) {
        return plugin.plugin_id;
      }
    }
  }
  return undefined;
}

/**
 * Pick a file size using realistic distribution:
 * - 70% small (5-10KB)
 * - 20% medium (20-30KB)
 * - 10% large (50-100KB)
 */
function pickFileSize(minKb: number, maxKb: number): number {
  const rand = Math.random();
  if (rand < 0.7) {
    // Small: 5-10KB range (or min-min*2 if range is smaller)
    const smallMin = minKb;
    const smallMax = Math.min(minKb * 2, maxKb);
    return smallMin + Math.random() * (smallMax - smallMin);
  } else if (rand < 0.9) {
    // Medium: 20-30KB range
    const medMin = Math.max(minKb, 20);
    const medMax = Math.min(30, maxKb);
    if (medMin >= medMax) return minKb + Math.random() * (maxKb - minKb);
    return medMin + Math.random() * (medMax - medMin);
  } else {
    // Large: 50-100KB range
    const lgMin = Math.max(minKb, 50);
    const lgMax = Math.min(100, maxKb);
    if (lgMin >= lgMax) return minKb + Math.random() * (maxKb - minKb);
    return lgMin + Math.random() * (lgMax - lgMin);
  }
}

/**
 * Build a realistic document body with multiple sections.
 * Adapts section content to the document type/folder context.
 */
function buildDocumentBody(title: string, folderType: string): string {
  const docType = folderType.toLowerCase();
  const isContact = docType.includes('contact');
  const isCompany = docType.includes('compan');
  const isNote = docType.includes('note') || docType.includes('project') || docType.includes('daily');
  const isTask = docType.includes('task');

  if (isContact) {
    return `# ${title}

## Contact Information

- **Email:** ${title.toLowerCase().replace(/\s+/g, '.')}@example.com
- **Phone:** +1 (555) ${Math.floor(Math.random() * 900 + 100)}-${Math.floor(Math.random() * 9000 + 1000)}
- **Company:** Acme Corp
- **Title:** Senior Manager

## Notes

This contact was added to the CRM vault for tracking purposes. The relationship started in early 2025 and has progressed through initial discovery, qualification, and active management stages.

## Interaction History

| Date | Type | Notes |
|------|------|-------|
| 2025-01-15 | Email | Initial outreach sent |
| 2025-02-03 | Call | Discovery call completed |
| 2025-03-10 | Meeting | In-person meeting at their office |

## Related Documents

- [[Companies/Acme Corp]]
- [[Tasks/Follow up with contact]]

`;
  }

  if (isCompany) {
    return `# ${title}

## Company Overview

- **Industry:** Technology
- **Size:** 200-500 employees
- **Founded:** 2010
- **Website:** https://example.com

## Key Contacts

- [[Contacts/Primary Contact]]
- [[Contacts/Technical Lead]]

## Notes

This company is a potential enterprise customer. They have expressed interest in the platform during Q1 2025 and have been engaged through multiple touchpoints. The procurement process is expected to take 6-8 weeks.

## Opportunities

| Stage | Value | Close Date |
|-------|-------|-----------|
| Discovery | $50,000 | 2025-06-01 |
| Proposal | $75,000 | 2025-07-15 |

`;
  }

  if (isTask) {
    return `# ${title}

## Task Details

- **Status:** Active
- **Priority:** Medium
- **Due:** 2025-06-30
- **Assigned:** Self

## Description

This task involves completing the required steps for the ongoing project. Multiple sub-tasks have been identified and are tracked below.

## Sub-tasks

- [ ] Step 1: Research and gather requirements
- [ ] Step 2: Draft initial proposal
- [ ] Step 3: Review with stakeholders
- [x] Step 4: Initial kickoff completed

## Notes

Progress has been steady. Blocking items have been resolved and the next review is scheduled for end of month.

`;
  }

  if (isNote) {
    return `# ${title}

## Overview

This document captures notes and context for the associated project or topic. Content is organized by date and updated regularly as new information becomes available.

## Key Points

- Point 1: Initial research confirms the approach is viable
- Point 2: Dependencies on external APIs identified
- Point 3: Timeline extended by two weeks due to scope changes

## Resources

- [External Reference](https://example.com/resource)
- [[Related Note 1]]
- [[Related Note 2]]

## Meeting Notes

### 2025-03-01

Discussed the primary objectives and confirmed priorities. Team agreed on the technical approach.

### 2025-03-15

Follow-up meeting. Progress review. Open items tracked below.

## Open Items

1. Resolve API authentication approach
2. Define success metrics
3. Schedule next review

`;
  }

  // Default/generic document
  return `# ${title}

## Summary

This document is part of the ${folderType} collection. It contains structured information relevant to the topic area.

## Content

Standard content placeholder for document type. The document has been created as part of the automated vault generation process.

## References

- [[Related Document 1]]
- [[Related Document 2]]

`;
}

/**
 * Generate lorem ipsum-style padding text to reach target file size.
 */
function generateLoremPadding(targetBytes: number): string {
  const loremParagraph = `
## Additional Context

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.

Sed ut perspiciatis unde omnis iste natus error sit voluptatem accusantium doloremque laudantium, totam rem aperiam, eaque ipsa quae ab illo inventore veritatis et quasi architecto beatae vitae dicta sunt explicabo. Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit aut fugit, sed quia consequuntur magni dolores eos qui ratione voluptatem sequi nesciunt.

At vero eos et accusamus et iusto odio dignissimos ducimus qui blanditiis praesentium voluptatum deleniti atque corrupti quos dolores et quas molestias excepturi sint occaecati cupiditate non provident, similique sunt in culpa qui officia deserunt mollitia animi, id est laborum et dolorum fuga.

`;

  let result = '';
  while (result.length < targetBytes) {
    result += loremParagraph;
  }

  return result.slice(0, targetBytes);
}

/**
 * Create a URL-safe slug from a title.
 */
function slugify(title: string, index: number): string {
  const base = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return `${base}-${index + 1}`;
}
