---
type: skill
fq_id: b86a9db8-c832-4ffb-9115-5bd6eae39194
fq_title: Do web research (Pattern 2 — referenced macro)
fq_status: active
fq_tags:
  - '#type/skill'
  - '#category/research'
fq_created: '2026-05-13T02:39:49.396+00:00'
fq_instance: work-center
fq_updated: '2026-05-18T18:35:02.716Z'
---

# Do web research (Pattern 2 — referenced macro via `source_ref`)

This is a worked example of Pattern 2 from `Meta/Skills/using-macros-in-skills.md`.
The macro lives in a separate vault document (`Macros/research-batch.md`);
this skill points at it by `source_ref` and supplies inputs in explicit
prose. Best when the macro is reused across multiple skills, OR when the
skill must work for both host and delegated LLM audiences with identical
text (no `{{ref}}` resolution required).

> See also: `do-web-research-pattern1.md` (inline) and
> `do-web-research-pattern3.md` ({{ref}} expansion).

> Skill consumers: reference `Meta/Skills/using-macros-in-skills.md` so
> the macro conventions are loaded into context before following the
> workflow below.

## Workflow

### Step 1 — Ask the user what to research

Ask the user what topic they want to research on the web. Wait for their
answer before proceeding.

### Step 2 — Brainstorm search phrases

Brainstorm 5–10 specific search phrases related to the user's topic. Avoid
overly broad or overly narrow terms.

### Step 3 — Run the research macro

Invoke `call_macro` with:

- `source_ref`: `"Macros/research-batch.md"`
  (The macro expects `search_phrases: string[]` and `output_path: string`,
  and returns `{ summary, count, file, queries_used }` via `exit`. Full
  contract is in the referenced macro doc — read it via `fq.get_document`
  if you need details.)
- `input_vars`:
  - `search_phrases`: the list of phrases you brainstormed in step 2
  - `output_path`: `"Research/web-output.md"` (or another vault path the
    user specifies)

### Step 4 — Summarize the findings

Use `result.file.fq_id` from the macro's response to fetch the saved
catalog via `fq.get_document`. Read the contents and produce a 3–5 sentence
summary. Prepend it to the catalog under a `# Summary` heading at the top
via `fq.insert_in_doc({ identifier: result.file.fq_id, position: "top",
content: "# Summary\n\n<your summary>\n" })`.

### Step 5 — Report to the user

Tell the user the research is complete. Include `result.summary` and a
link to the saved document at `result.file.path`.

## Trade-offs of Pattern 2

- ✅ Macro source lives once in the vault; multiple skills can reference it
- ✅ Macro is version-controlled and `fq_id`-referenceable as a first-class
  vault artifact
- ✅ Works identically for host AND delegated LLM audiences — no
  `{{ref}}` resolution required, so no host-side workaround needed
- ❌ The macro's contract is partially duplicated in the skill prose
  (the inline note about expected `input_vars`); if the macro's contract
  changes, this skill needs an update too
- ❌ Slightly more skill prose than Pattern 3
