import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const TOOL_SOURCES = {
  write_document: 'src/mcp/tools/documents/write.ts',
  insert_doc_link: 'src/mcp/tools/compound.ts',
  apply_tags: 'src/mcp/tools/compound.ts',
  insert_in_doc: 'src/mcp/tools/compound.ts',
  replace_doc_section: 'src/mcp/tools/compound.ts',
  archive_document: 'src/mcp/tools/documents/archive.ts',
  remove_document: 'src/mcp/tools/documents/remove.ts',
  copy_document: 'src/mcp/tools/documents/copy.ts',
  move_document: 'src/mcp/tools/documents/move.ts',
} as const;

type VersionedToolName = keyof typeof TOOL_SOURCES;

function readSource(path: string): string {
  return readFileSync(path, 'utf8');
}

function toolRegistrationChunk(toolName: VersionedToolName): string {
  const source = readSource(TOOL_SOURCES[toolName]);
  const start = source.indexOf(`'${toolName}'`);
  expect(start, `${toolName} registration must exist`).toBeGreaterThan(-1);
  const nextRegistration = source.indexOf('server.registerTool(', start + 1);
  return source.slice(start, nextRegistration === -1 ? undefined : nextRegistration);
}

function expectVersionAliases(toolName: VersionedToolName): void {
  const chunk = toolRegistrationChunk(toolName);

  expect(chunk, `${toolName} input schema must accept expected_version`).toMatch(
    /\bexpected_version\b[\s\S]*z\.string\(\)[\s\S]*\.optional\(\)/
  );
  expect(chunk, `${toolName} input schema must accept if_match alias`).toMatch(
    /\bif_match\b[\s\S]*z\.string\(\)[\s\S]*\.optional\(\)/
  );
}

describe('REQ-012 expected_version / if_match schema contract', () => {
  it.each([
    'write_document',
    'insert_doc_link',
    'insert_in_doc',
    'replace_doc_section',
    'archive_document',
    'remove_document',
    'copy_document',
    'move_document',
  ] satisfies VersionedToolName[])(
    'T-U-022 %s accepts optional expected_version and if_match',
    (toolName) => {
      expectVersionAliases(toolName);
    }
  );

  it('T-U-022 apply_tags accepts version aliases for document targets without implying memory target locking', () => {
    const chunk = toolRegistrationChunk('apply_tags');

    expect(chunk).toContain("'apply_tags'");
    expect(chunk).toMatch(/entity_type:\s*z\.literal\('document'\)/);
    expect(chunk).toMatch(/entity_type:\s*z\.literal\('memory'\)/);
    expect(chunk).toMatch(
      /z\.strictObject\(\{[\s\S]*entity_type[\s\S]*identifier[\s\S]*expected_version[\s\S]*if_match[\s\S]*\}\)/
    );
    expect(chunk).toMatch(/\bexpected_version\b[\s\S]*z\.string\(\)[\s\S]*\.optional\(\)/);
    expect(chunk).toMatch(/\bif_match\b[\s\S]*z\.string\(\)[\s\S]*\.optional\(\)/);
    const memoryTargetStart = chunk.indexOf("entity_type: z.literal('memory')");
    const memoryTargetEnd = chunk.indexOf('}),', memoryTargetStart);
    const memoryTargetChunk = chunk.slice(memoryTargetStart, memoryTargetEnd);
    expect(memoryTargetChunk).not.toContain('expected_version');
    expect(memoryTargetChunk).not.toContain('if_match');
  });
});
