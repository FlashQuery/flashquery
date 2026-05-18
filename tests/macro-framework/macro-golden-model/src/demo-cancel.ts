// Cancellation demo for the golden model.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "./parser.ts";
import { evaluate, makeExecContext, MacroCancellationError } from "./evaluator.ts";
import { builtins } from "./builtins.ts";
import { defaultToolRegistry } from "./mockfq.ts";

const CANCEL_AFTER_MS = 500;
const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = resolve(__dirname, "../examples/07-cancellation.fqm");

const source = readFileSync(SOURCE_PATH, "utf8");

console.log("==============================================");
console.log(" cancellation demo");
console.log("==============================================");
console.log(`source: ${SOURCE_PATH}`);
console.log(`will cancel after: ${CANCEL_AFTER_MS}ms`);
console.log("");

const exec = makeExecContext({ macroSource: source });
console.log(`task created: ${exec.taskId} (status=working)`);
console.log("");

const cancelTimer = setTimeout(() => {
  console.log("");
  console.log(`>>> [demo] firing taskRegistry.cancel(${exec.taskId.slice(0, 8)}…)`);
  console.log("");
  exec.taskRegistry.cancel(exec.taskId);
}, CANCEL_AFTER_MS);

async function main() {
  try {
    const program = parse(source);
    await evaluate(program, { builtins, tools: defaultToolRegistry, exec });
    clearTimeout(cancelTimer);
    const t = exec.taskRegistry.get(exec.taskId);
    if (t && t.status === "working") {
      exec.taskRegistry.complete(exec.taskId, null);
    }
    console.log("");
    console.log("macro completed before cancellation fired.");
  } catch (e) {
    if (e instanceof MacroCancellationError) {
      console.log("");
      console.log(`<<< macro threw MacroCancellationError: ${e.message}`);
      console.log(`  at_safe_point: ${e.at_safe_point ?? "(unspecified)"}`);
    } else {
      console.error("UNEXPECTED ERROR:", e);
      process.exitCode = 1;
    }
  } finally {
    exec.taskRegistry.clearCurrentTask();
    const record = exec.taskRegistry.get(exec.taskId);
    if (record) {
      console.log("");
      console.log("=== final task record ===");
      console.log(`  taskId:         ${record.taskId}`);
      console.log(`  status:         ${record.status}`);
      console.log(`  createdAt:      ${record.createdAt}`);
      console.log(`  lastUpdatedAt:  ${record.lastUpdatedAt}`);
      const created = Date.parse(record.createdAt);
      const updated = Date.parse(record.lastUpdatedAt);
      console.log(`  elapsed:        ${updated - created}ms`);
      console.log(`  latest message: ${record.statusMessage ?? "(none)"}`);
      console.log(`  trace steps:    ${record.trace.length}`);
    }
  }
}

main();
