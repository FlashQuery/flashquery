import { readFile } from 'fs/promises';
import matter from 'gray-matter';
import { join } from 'path';

async function parseDocMeta(vaultRoot, relativePath) {
  try {
    const raw = await readFile(join(vaultRoot, relativePath), 'utf-8');
    const { data } = matter(raw);
    return {
      relativePath,
      title: String(data.title ?? relativePath),
      tags: Array.isArray(data.tags) ? (data.tags) : [],
      project: String(data.project ?? ''),
      status: String(data.status ?? 'active'),
      fqcId: String(data.fqc_id ?? ''),
      modified: String(data.updated ?? data.created ?? ''),
    };
  } catch (err) {
    console.warn(`parseDocMeta: skipping malformed file ${relativePath}`);
    return null;
  }
}

const vaultRoot = '/Users/matt/Documents/Obsidian/Vault';

// Test each file from the DB
const files = [
  'CRM/Companies/Dover Fueling Solutions.md',
  'CRM/Companies/Trump Data Systems.md',
  'CRM/Contacts/Sally Struthers.md',
  'meeting-notes.md',
  'notes.md'
];

for (const f of files) {
  const meta = await parseDocMeta(vaultRoot, f);
  if (meta) {
    console.log(`✓ ${f}`);
    console.log(`  title: ${meta.title}`);
    console.log(`  status: ${meta.status}`);
    console.log(`  fqcId: ${meta.fqcId}`);
  } else {
    console.log(`✗ ${f} (parse failed)`);
  }
}
