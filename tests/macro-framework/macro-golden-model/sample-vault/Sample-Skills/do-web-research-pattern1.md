---
type: skill
fq_id: f9db4507-8f58-4a8d-85c4-d27f45f0dca0
fq_title: Do web research (Pattern 1 — inline macro)
fq_status: active
fq_tags:
  - '#type/skill'
  - '#category/research'
fq_created: '2026-05-13T02:39:49.396+00:00'
fq_instance: work-center
fq_updated: '2026-05-18T18:35:02.548Z'
---

# Do web research (Pattern 1 — inline macro at point of invocation)

This is a worked example of Pattern 1 from `Meta/Skills/using-macros-in-skills.md`.
The macro source is embedded directly in the skill at the step where it's
invoked. Best when the macro is short, single-use, and tightly coupled to
this specific workflow.

> See also: `do-web-research-pattern2.md` (Pattern 2 — referenced via
> `source_ref`) and `do-web-research-pattern3.md` (Pattern 3 — self-
> describing macro doc via `{{ref}}`).

> Skill consumers: reference `Meta/Skills/using-macros-in-skills.md` so
> the macro conventions are loaded into context before following the
> workflow below.

## Workflow

### Step 1 — Ask the user what to research

Ask the user what topic they want to research on the web. Wait for their
answer before proceeding.

### Step 2 — Brainstorm search phrases

Brainstorm 5–10 specific search phrases related to the user's topic. For
"AI safety," good phrases would be things like "guardian models," "AI
governance frameworks," "alignment research 2026," etc. Avoid overly
broad terms ("AI") and overly narrow ones ("Yoshua Bengio's December 2025
blog post").

### Step 3 — Run the research macro

Invoke `call_macro` with:

- `source`: the macro defined below — **copy verbatim from between the
  fence markers; do not modify**
- `input_vars`:
  - `search_phrases`: the list of phrases you brainstormed in step 2
  - `output_path`: `"Research/web-output.md"` (or another vault path the
    user specifies)

```fqm name=research_batch
if ! brave_search._exists() then
  fail "Brave Search broker is not connected — cannot perform research."
fi
if ! web_fetch._exists() then
  fail "Web fetch broker is not connected — cannot retrieve page content."
fi

total_queries = count $search_phrases
pages = []
i = 0
for p in $search_phrases
  i = add $i 1
  status --progress $i --total $total_queries "searching: $p"

  hits = brave_search.web_search({ query: $p, count: 2 })
  for h in $hits
    page = web_fetch.fetch({ url: $h.url })
    pages = append $pages {
      query: $p,
      url: $h.url,
      title: $h.title,
      content: $page.content
    }
  done
done

n = count $pages

saved = fq.write_document({
  mode: "create",
  path: $output_path,
  title: "Research output",
  content: "auto-generated from $n pages"
})

exit {
  summary: "completed $n-page research over $search_phrases",
  count: $n,
  file: $saved
}
```

### Step 4 — Summarize the findings

Use `result.file.fq_id` from the macro's response to fetch the saved
catalog via `fq.get_document`. Read the contents and produce a 3–5 sentence
summary of the most important findings across the queries. Prepend the
summary to the catalog under a `# Summary` heading at the top of the
document via `fq.insert_in_doc({ identifier: result.file.fq_id, position:
"top", content: "# Summary\n\n<your summary>\n" })`.

### Step 5 — Report to the user

Tell the user the research is complete. Include `result.summary` and a
link to the saved document at `result.file.path`. Do not summarize the
research again — that's already in the document.

## Trade-offs of Pattern 1

- ✅ Everything in one place — easy to read end-to-end
- ✅ No separate macro file to maintain
- ❌ Macro source is not reusable across other skills
- ❌ Larger skill text; the macro source consumes the LLM's context window
- ❌ Any update to the macro logic means updating every skill that inlines it
