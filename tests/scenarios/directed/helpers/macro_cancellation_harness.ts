#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { load } from 'js-yaml';
import { z } from 'zod';
import type { FlashQueryConfig } from '../../../../src/config/loader.ts';
import type { NativeToolDefinition } from '../../../../src/llm/tool-registry.ts';
import { MacroTaskRegistry, type MacroTaskRecord } from '../../../../src/macro/task-registry.ts';
import { runMacroSource } from '../../../../src/mcp/tools/macro.ts';
import { NullMcpBroker } from '../../../../src/services/mcp-broker.ts';

const mode = process.argv[2] ?? '';
const configPath = process.argv[3] ?? '';
const vaultPath = process.argv[4] ?? '';

if (!['cancellation', 'no-partial-side-effects'].includes(mode) || !configPath || !vaultPath) {
  console.error('Usage: macro_cancellation_harness.ts <cancellation|no-partial-side-effects> <config-path> <vault-path>');
  process.exit(2);
}

const loadedConfig = load(await readFile(configPath, 'utf8')) as FlashQueryConfig;
const config = {
  ...loadedConfig,
  hostMcpTools: { tools: ['write_document'] },
} as FlashQueryConfig;
const sessionId = `macro-directed-${mode}`;
const taskRegistry = new MacroTaskRegistry();
const transitions: MacroTaskRecord[] = [];
const targetPath = 'macro-cancel/post-cancel.md';
const targetAbsPath = join(vaultPath, targetPath);
let writeAttempted = false;

const catalog: NativeToolDefinition[] = [
  {
    name: 'write_document',
    description: 'directed cancellation write_document probe',
    inputSchema: {
      path: z.string(),
      content: z.string().optional(),
    },
    handler: async (args) => {
      writeAttempted = true;
      await writeFile(join(vaultPath, String(args['path'])), String(args['content'] ?? ''), 'utf8');
      return {
        content: [{ type: 'text', text: JSON.stringify({ path: args['path'], written: true }) }],
      };
    },
  },
];

const source = mode === 'cancellation'
  ? 'sleep 500\nexit "not-cancelled"'
  : `
      for item in [1,2] do
        sleep 500
        fq.write_document({
          path: "${targetPath}",
          content: "post-cancel mutation"
        })
      done
      exit "not-cancelled"
    `;

const run = runMacroSource({
  source,
  sessionId,
  taskRegistry,
  config,
  catalog,
  broker: new NullMcpBroker(),
  nativeDispatchContext: {
    signal: new AbortController().signal,
    instanceId: config.instance.id,
    logContext: { test: 'macro_cancellation_harness', mode },
  },
  onTaskTransition: (record) => transitions.push(record),
});

const workingTask = await waitForWorkingTask(taskRegistry, sessionId);
const cancelAccepted = taskRegistry.cancel(workingTask.task_id, sessionId, (record) => transitions.push(record));
const output = await run;
const envelope = JSON.parse(output.result.content[0]?.text ?? '{}') as Record<string, unknown>;
const fileContent = await readOptionalFile(targetAbsPath);

console.log(JSON.stringify({
  mode,
  cancelAccepted,
  observedTaskId: workingTask.task_id,
  safePoint: extractSafePoint(envelope),
  envelope,
  writeAttempted,
  targetPath,
  fileExists: fileContent !== null,
  fileContent,
  transitions: transitions.map((record) => ({
    task_id: record.task_id,
    status: record.status,
    session_id: record.session_id,
  })),
}, null, 2));

async function waitForWorkingTask(
  registry: MacroTaskRegistry,
  session: string
): Promise<MacroTaskRecord> {
  const started = Date.now();
  while (Date.now() - started < 2_000) {
    const task = registry.list(session).find((record) => record.status === 'working');
    if (task) return task;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('Timed out waiting for MacroTaskRegistry working task');
}

async function readOptionalFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function extractSafePoint(envelope: Record<string, unknown>): unknown {
  const details = envelope['details'];
  if (details && typeof details === 'object' && !Array.isArray(details)) {
    return (details as Record<string, unknown>)['at_safe_point'];
  }
  return undefined;
}
