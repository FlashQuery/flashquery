// Demo runner for the FlashQuery macro language golden model.

import { parse, ParseError } from "./parser.ts";
import { evaluate, makeExecContext, MacroRuntimeError, MacroFailError } from "./evaluator.ts";
import { builtins } from "./builtins.ts";
import { defaultToolRegistry } from "./mockfq.ts";

const exampleA = `
# Example A — drafts → archive
# Demonstrates: bind, namespaced tool call, for-loop, string interpolation, count.

fq.manage_directory({ action: "create", paths: ["Q3-2026"] })
drafts = fq.search({ query: "tag:#draft" })

for d in $drafts do
  fq.move_document({ identifier: $d.fq_id, destination: "Q3-2026/" })
  fq.apply_tags({ targets: [{ entity_type: "document", identifier: $d.fq_id }], add_tags: ["#archived"] })
done

total = count $drafts
echo "moved $total drafts"
`;

const exampleB = `
# Example B — review-readiness check (uses model-call pattern)

drafts = fq.search({ query: "tag:#draft" })

for d in $drafts do
  verdict = fq.call_model({
    resolver: "purpose",
    name: "draft-reviewer",
    messages: [{ role: "user", content: "is this draft ready for review? $d.fq_id" }],
    parameters: { response_format: { type: "json_schema", schema: { "ready": "boolean", "reason": "string" } } }
  })
  if $verdict.ready then
    fq.move_document({ identifier: $d.fq_id, destination: "Review/" })
    echo "moved to Review/: $verdict.reason"
  else
    fq.apply_tags({ targets: [{ entity_type: "document", identifier: $d.fq_id }], add_tags: ["#needs-work"] })
    echo "kept in drafts:" $verdict.reason
  fi
done
`;

const exampleC = `
# Example C — input_var contract

topic = input_var "topic"
hits = input_var "hits" --default 3
reviewer = input_var "reviewer" --default null

echo "researching: $topic"
echo "max hits: $hits"

if $reviewer then
  echo "reviewer assigned: $reviewer"
else
  echo "no reviewer assigned — will skip notification"
fi

exit { topic: $topic, hits: $hits, reviewer: $reviewer }
`;

async function run(label: string, source: string, inputVars?: Record<string, unknown>): Promise<void> {
  console.log(`\n===== ${label} =====`);
  console.log("--- source ---");
  console.log(source.trim());
  console.log("--- output ---");
  const exec = makeExecContext({ macroSource: source });
  try {
    const program = parse(source);
    const result = await evaluate(program, {
      builtins,
      tools: defaultToolRegistry,
      inputVars: inputVars as Record<string, import("./types.ts").Value> | undefined,
      exec,
    });
    exec.taskRegistry.complete(exec.taskId, null);
    if (result !== null) {
      console.log("\n--- macro result ---");
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (e) {
    exec.taskRegistry.fail(exec.taskId, {
      kind: (e as Error).constructor?.name ?? "Error",
      message: String((e as Error).message ?? e),
    });
    if (e instanceof ParseError) {
      console.error("PARSE ERROR:");
      console.error(e.message);
    } else if (e instanceof MacroFailError) {
      console.error("MACRO ABORTED (fail):");
      console.error(e.message);
    } else if (e instanceof MacroRuntimeError) {
      console.error("RUNTIME ERROR:");
      console.error(e.message);
    } else {
      console.error("UNEXPECTED ERROR:");
      console.error(e);
    }
    process.exitCode = 1;
  } finally {
    exec.taskRegistry.clearCurrentTask();
  }
}

async function main() {
  await run("Example A — drafts → archive", exampleA);
  await run("Example B — review-readiness check", exampleB);
  await run(
    "Example C — input_var contract",
    exampleC,
    { topic: "FlashQuery macro language" },
  );
  console.log();
}

main();
