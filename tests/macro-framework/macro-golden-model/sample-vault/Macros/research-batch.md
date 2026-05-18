---
type: macro_library
fq_id: 08ed7c47-b4e0-4431-b810-66ff45cce0fe
fq_title: research-batch
fq_status: active
fq_tags:
  - '#type/macro_library'
  - '#category/research'
fq_created: '2026-05-18T18:32:44.196+00:00'
fq_instance: work-center
fq_updated: '2026-05-18T18:35:03.696Z'
---

# research-batch

A reusable macro that performs a batch of web searches and fetches the top
results for each query, returning the collected pages as a structured list
and saving a catalog document to the vault.

## Usage

Invoke `call_macro` with `source_ref` pointing at this document, and
`input_vars` providing the queries and output location.

```json
{
  "source_ref": "Macros/research-batch.md",
  "input_vars": {
    "search_phrases": ["AI safety", "model alignment"],
    "output_path": "Research/web-output.md"
  }
}
```

## Expected `input_vars`

The macro declares its inputs at the top of the `fqm` source via `input_var`
lines. Those declarations *are* the contract — read them to confirm what
the caller must pass:

- `search_phrases`: `string[]` — **required**. The queries to research. The
  macro iterates this list and fetches `hits_per_topic` results per query.
  Can be any length ≥ 1 (zero-to-N pattern).
- `output_path`: `string` — **optional**. Vault path where the catalog
  document will be written. Default: `"Research/web-output.md"`. Parent
  directories must exist.
- `hits_per_topic`: `number` — **optional**. Max search hits per query.
  Default: `2`.

## Returns (via `exit`)

A structured object the caller field-accesses for the next step:

- `summary`: `string` — human-readable summary line
- `count`: `number` — total number of pages fetched (queries × top-results)
- `file`: `DocumentIdentificationBlock` — `{ identifier, title, path, fq_id,
  modified, size }` for the saved catalog. Use `result.file.fq_id` to fetch
  the document in a subsequent step.
- `queries_used`: `string[]` — echo of `search_phrases` for traceability

## Required tool registry

This macro calls into three namespaces. The caller's tool registry must
include them:

- `fq.*` — for `fq.write_document` (always available in a FlashQuery context)
- `brave_search.web_search` — brokered MCP server for web search
- `web_fetch.fetch` — brokered MCP server for URL fetching

If a required broker is not connected, the macro fails fast via `fail` (see
the guard block at the top of the source).

## Source

```fqm name=research_batch
# --- Input contract -----------------------------------------------------
# Each line below declares an input. Required inputs use the bare form;
# optional inputs use --default <literal>.

# List of search phrases to research. Required; can be any length ≥ 1.
search_phrases = input_var "search_phrases"

# Vault path where the catalog will be written. Defaults to a stable
# location so the caller can omit it for casual one-off runs.
output_path = input_var "output_path" --default "Research/web-output.md"

# Max search hits to fetch per phrase. Defaults to 2.
hits_per_topic = input_var "hits_per_topic" --default 2

# --- Guard --------------------------------------------------------------
# Bail with a clear error if a required broker is offline.

if ! brave_search._exists() then
  fail "Brave Search broker is not connected — cannot perform research."
fi
if ! web_fetch._exists() then
  fail "Web fetch broker is not connected — cannot retrieve page content."
fi

echo "starting research with queries:" $search_phrases
echo "will save catalog to:" $output_path

# --- Iteration ----------------------------------------------------------
# Iterate the queries and fetch the top results for each.

total_queries = count $search_phrases
pages = []
i = 0
for p in $search_phrases
  i = add $i 1
  status --progress $i --total $total_queries "searching: $p"

  hits = brave_search.web_search({ query: $p, count: $hits_per_topic })
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
  content: "auto-generated from $n pages across the provided queries"
})

# Exit with a structured handoff. The calling LLM uses result.file.fq_id
# to fetch the saved catalog in its next step, and may surface
# result.summary as narration to the user.
exit {
  summary: "completed $n-page research over $search_phrases",
  count: $n,
  file: $saved,
  queries_used: $search_phrases
}
```

## Notes

- This macro is **idempotent in spirit but not in practice** — running it
  twice creates two catalog documents at the same path (the second `mode:
  "create"` call would fail with `conflict`). Wrap in a guard or use
  `mode: "update"` if you need re-run semantics.
- The zero-to-N pattern: `search_phrases` is a list of any length ≥ 1. A
  caller skill that brainstorms variable numbers of topics doesn't need to
  know about the macro's iteration logic — just pass the list.
- Page content is mock data in the prototype. In production this would be
  the actual fetched page content (subject to whatever extraction the
  `web_fetch` broker performs).
