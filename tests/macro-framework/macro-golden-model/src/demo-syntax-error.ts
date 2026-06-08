// Demonstrates parser error reporting on a deliberately malformed macro.

import { parse, ParseError } from "./parser.ts";

const broken = `
fq.manage_directory({ action: "create", paths: ["Q3-2026"] })
drafts = fq.search({ query: "tag:#draft" })

for d in $drafts do
  fq.move_document({ identifier: $d.fq_id, destination: "Q3-2026/" })
  fq.apply_tags({ targets: [{ entity_type: "document", identifier: $d.fq_id }], add_tags: ["#archived"] })
# (missing 'done' here)
`;

console.log("--- malformed source ---");
console.log(broken.trim());
console.log("--- parse result ---");
try {
  parse(broken);
  console.log("(unexpectedly parsed without errors)");
} catch (e) {
  if (e instanceof ParseError) {
    console.error(e.message);
    console.error("");
    console.error("structured errors:");
    console.error(JSON.stringify(e.errors, null, 2));
  } else {
    console.error(e);
  }
  process.exitCode = 1;
}
