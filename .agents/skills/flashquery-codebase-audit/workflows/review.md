# Workflow: Review (Layer 2 — targeted AI review)

The Review workflow reads code and produces findings. The mechanical Sweep found
what tools can find; Review finds what only a careful reading can — the `catch`
that logs to a dead channel, the untyped boundary no tool flagged, the
abstraction that leaks, the comment that lies. This is where judgment happens.

## Inputs

- The structured inventory and hotspot ranking from the Sweep workflow.
- `references/audit-method.md` — the **19-category detection taxonomy (A–S)** is
  your checklist. Read the entries for the categories you are reviewing.
- `references/typescript-standard.md` — the standard each finding is judged
  against.
- `references/output-template.md` — the per-finding schema every finding must
  follow.

## Why this is chunked

Nineteen categories over even ~120 source files will not fit one pass with
the depth each category needs. Review is meant to be **invoked per category
group** so each run is tractable. Suggested groups:

- Error handling, observability, resource lifecycle (A, L, M)
- Type safety, weak type modeling, async & concurrency (B, C, O)
- MCP contracts, LLM & context safety, data & schema (Q, R, P)
- Structure, complexity, performance, dead code (D, G, H, N)
- Dependencies, config, docs, tests, security/release (E, F, I, J, K, S)

If the user named a group or a category, do that one. Otherwise confirm which
group(s) to run before starting.

## Steps

1. For the chosen category group, read the matching taxonomy entries in
   `references/audit-method.md` so the checks are precise.
2. Read the hotspots Sweep ranked highest for those categories, plus a
   risk-weighted sample of the rest. Prioritize error-handling code, module
   boundaries, data parsing, MCP tool handlers, macro execution, plugin loading,
   LLM and embedding calls, redaction, and authorization.
3. For each genuine issue, write a finding using the schema in
   `references/output-template.md` — diagnosis, why it matters, remediation,
   related tests, new tests needed, verification, and the rest. Cite the
   relevant `typescript-standard.md` section where one applies.
4. Set **severity**, **effort**, and **blast radius** per the model in
   `references/audit-method.md`. Set **confidence**: *Confirmed* only when you
   verified it against the code, otherwise *To verify*.
5. Raise an **Open question** only where the fix turns on a genuine
   product-behavior decision — never for an implementation or architecture
   choice the fix-agent should make itself. See `references/output-template.md`.

## Output

A set of findings — the issue inventory for the chosen group — handed to the
Report workflow. Do not assemble the final report here; Report does that.
