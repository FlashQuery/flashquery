import { readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, relative, join } from 'path';

async function listMarkdownFiles(vaultRoot, extensions = ['.md']) {
  console.log(`[DEBUG] listMarkdownFiles called with vaultRoot="${vaultRoot}"`);
  console.log(`[DEBUG] existsSync(vaultRoot) = ${existsSync(vaultRoot)}`);
  
  if (!existsSync(vaultRoot)) {
    console.log(`[DEBUG] Path does not exist, returning []`);
    return [];
  }

  const extsLower = extensions.map((e) => e.toLowerCase());
  const entries = await readdir(vaultRoot, { recursive: true, withFileTypes: true });
  console.log(`[DEBUG] Found ${entries.length} total entries`);
  
  const files = entries
    .filter((e) => e.isFile() && extsLower.includes(extname(e.name).toLowerCase()))
    .map((e) => {
      const dir =
        (e).parentPath ?? (e).path ?? vaultRoot;
      return relative(vaultRoot, join(dir, e.name));
    });
  
  console.log(`[DEBUG] Filtered to ${files.length} .md files`);
  return files;
}

const vaultRoot = '/Users/matt/Documents/Obsidian/Vault';
const files = await listMarkdownFiles(vaultRoot, ['.md']);
console.log('\nResults:');
files.forEach(f => console.log(`  ${f}`));
