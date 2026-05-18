---
type: macro_library
fq_id: 5647312a-1238-4a45-be20-1e35d44ea13e
fq_title: Projection helpers
fq_status: active
fq_tags:
  - '#type/macro_library'
  - '#category/projections'
fq_created: '2026-05-13T19:55:30.843+00:00'
fq_updated: '2026-05-18T18:35:03.199Z'
fq_instance: work-center
---

# Projection helpers

A small library of macros for managing projections on documents in the
vault. Demonstrates the OQ #30 macro-library pattern: multiple named
macros in one doc, each addressable via `source_ref` `::name` selectors (per OQ #31).

A *projection* on a document is a derived view tag or computed property —
e.g., `summary`, `outline`, `next-actions`. This library provides three
related operations against that concept.

## Usage

Invoke `call_macro` with `source_ref` pointing at the named block:

```json
{
  "source_ref": "Macros/projections.md::add_projections",
  "input_vars": {
    "target_doc": "Documents/spec.md",
    "projections": ["summary", "outline"]
  }
}
```

Other entry points in this library:

- `source_ref: "Macros/projections.md::remove_projections"`
- `source_ref: "Macros/projections.md::list_projections"`

If you invoke without an anchor (`source_ref: "Macros/projections.md"`),
the engine returns `invalid_input` with `details.reason:
"ambiguous_macro_block"` and lists the available names.

## add_projections

Adds one or more projection tags to a document.

**Required input_vars:**
- `target_doc` (string) — path or fq_id of the document to tag
- `projections` (string[]) — list of projection names to add

**Returns (via exit):**
- `{ added: string[], file: DocumentIdentificationBlock }`

```fqm name=add_projections
target_doc = input_var "target_doc"
projections = input_var "projections"

# Resolve the doc first to get its identification block
doc = fq.get_document({ identifier: $target_doc })

# Build tag set from projection names
tag_targets = [{ entity_type: "document", identifier: $doc.fq_id }]
projection_tags = []
for p in $projections
  projection_tags = append $projection_tags "#projection/$p"
done

fq.apply_tags({ targets: $tag_targets, tags: $projection_tags })

echo "added $projections to $doc.path"

exit {
  added: $projections,
  file: $doc
}
```

## remove_projections

Removes one or more projection tags from a document. Symmetric counterpart
to `add_projections`.

**Required input_vars:**
- `target_doc` (string) — path or fq_id of the document
- `projections_to_remove` (string[]) — list of projection names to remove

**Returns (via exit):**
- `{ removed: string[], file: DocumentIdentificationBlock }`

```fqm name=remove_projections
target_doc = input_var "target_doc"
projections_to_remove = input_var "projections_to_remove"

doc = fq.get_document({ identifier: $target_doc })

tag_targets = [{ entity_type: "document", identifier: $doc.fq_id }]
projection_tags = []
for p in $projections_to_remove
  projection_tags = append $projection_tags "#projection/$p"
done

# (In a real implementation, this would call a remove_tags tool. The
# prototype's mock doesn't have one, so we just echo what would happen.)
echo "would remove $projection_tags from $doc.path"

exit {
  removed: $projections_to_remove,
  file: $doc
}
```

## list_projections

Lists all projection tags currently applied to a document.

**Required input_vars:**
- `target_doc` (string) — path or fq_id of the document

**Returns (via exit):**
- `{ projections: string[], file: DocumentIdentificationBlock }`

```fqm name=list_projections
target_doc = input_var "target_doc"

doc = fq.get_document({ identifier: $target_doc })

# In a real implementation, this would filter $doc.tags for
# entries matching the "#projection/" prefix. The prototype mock
# returns a canned list.
projection_list = []
for t in $doc.tags
  # In real macros this would be a startsWith check; here we just
  # echo and pass the tag through for demonstration purposes.
  projection_list = append $projection_list $t
done

echo "found $projection_list projections on $doc.path"

exit {
  projections: $projection_list,
  file: $doc
}
```

## Notes

- All three macros are independent — you invoke whichever one you need
  via the `::name` selector; the others don't run.
- The macros share an input convention: `target_doc` is always the
  document identifier. This consistency makes the library easier for
  AI authors to compose.
- Per OQ #30, the engine validates name resolution per-lookup. If you
  request a name that exists once, you get it; if it's ambiguous (two
  blocks with the same name), you get `duplicate_block_name`; if it's
  missing, you get `block_not_found` with the available names listed
  so you can self-correct.
