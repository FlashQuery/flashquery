---
type: skill
fq_id: 2694bdf0-7c47-4786-beda-78d1eb2e1d85
fq_title: Do web research (Pattern 3 — self-describing macro via ref expansion)
fq_status: active
fq_tags:
  - '#type/skill'
  - '#category/research'
fq_created: '2026-05-13T02:39:49.396+00:00'
fq_instance: work-center
fq_updated: '2026-05-18T18:35:02.878Z'
---

# Do web research (Pattern 3 — self-describing macro via `{{ref}}` expansion)

This is a worked example of Pattern 3 from `Meta/Skills/using-macros-in-skills.md`.
The macro doc carries its own usage instructions (`Macros/research-batch.md`
includes a `## Usage` section), and this skill uses `{{ref:...}}` to inline
the macro doc into context. Skill prose is minimal — just the reference and
the inputs adjacent.

> See also: `do-web-research-pattern1.md` (inline) and
> `do-web-research-pattern2.md` (referenced via `source_ref`).

> Skill consumers: reference `Meta/Skills/using-macros-in-skills.md` so
> the macro conventions are loaded into context before following the
> workflow below.
>
> **Host-LLM note:** if you see literal `{{ref:Macros/research-batch.md}}`
> in step 3 below (because you're the host model and reference expansion
> doesn't run on skill text you read directly), follow the host self-
> resolve convention from the meta-skill: call `call_model({ messages:
> [{ role: "user", content: <the section containing the marker> }],
> dry_run: true, include_resolved_messages: true })` to trigger expansion,
> then proceed with the resolved text.

## Workflow

### Step 1 — Ask the user what to research

Ask the user what topic they want to research on the web. Wait for their
answer before proceeding.

### Step 2 — Brainstorm search phrases

Brainstorm 5–10 specific search phrases related to the user's topic. Avoid
overly broad or overly narrow terms.

### Step 3 — Run the research macro

{{ref:Macros/research-batch.md}}

Inputs:
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

## Trade-offs of Pattern 3

- ✅ Maximally compact skill prose — the macro doc carries its own usage
  contract, so the skill just supplies the inputs
- ✅ Macro reusable across many skills without each skill duplicating the
  contract description
- ✅ The macro doc body inlines into context when expanded, giving the
  LLM full visibility into what's about to run
- ❌ Host/delegated asymmetry: delegated models get auto-expansion via
  `call_model` preprocessing; host models need to self-resolve via
  `call_model({dry_run: true})` (per the meta-skill's note above) until
  the cross-cutting `dry_run` capability lands universally
- ❌ Slightly more setup cost (the macro doc must follow the self-
  describing convention) — but pays off as the macro is reused
