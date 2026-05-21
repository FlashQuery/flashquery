import { readFile } from 'node:fs/promises';
import { load as loadYaml } from 'js-yaml';
import { captureSnapshot, defaultToolRegistry } from './load.ts';

async function main() {
  const text = await readFile('tests/macro-framework/cases/control-flow/04-while-with-fail.yml', 'utf8');
  const tc = loadYaml(text) as any;
  const env = await captureSnapshot(tc.macro, tc.input_vars ?? {}, tc.vault ?? {}, { registry: defaultToolRegistry }, {});
  const oldNotes = tc.golden_snapshot?.state_notes ?? [];
  const newNotes = env.state_notes;
  console.log('OLD[0]:', JSON.stringify(oldNotes[0]));
  console.log('NEW[0]:', JSON.stringify(newNotes[0]));
  console.log('lengths:', oldNotes.length, newNotes.length);
  const diffIdx = oldNotes.findIndex((n: unknown, i: number) => JSON.stringify(n) !== JSON.stringify(newNotes[i]));
  console.log('First diff at idx', diffIdx);
  if (diffIdx >= 0) {
    console.log('OLD[diff]:', JSON.stringify(oldNotes[diffIdx]));
    console.log('NEW[diff]:', JSON.stringify(newNotes[diffIdx]));
  }
}
main();
