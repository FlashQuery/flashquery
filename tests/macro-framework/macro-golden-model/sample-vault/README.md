---
fq_id: 437d9bef-7f35-4ccb-be14-f1d907e1e873
fq_title: README
fq_created: '2026-05-13T02:39:49.396+00:00'
fq_status: active
fq_instance: work-center
fq_updated: '2026-05-18T18:35:01.906Z'
---
# Sample Vault — Macro Convention Reference

This directory holds canonical examples of how macros and macro-using skills
are organized in a FlashQuery vault. It demonstrates conventions resolved in
the research doc (§3 R9 "Skill-macro embedding: three patterns") without
running them — these are *documentation artifacts*, not executable tests.

For runnable macros against mock tools, see `../examples/*.fqm` instead.

## Structure

```
sample-vault/
  Macros/
    research-batch.md           ← Single-macro library doc (Pattern 3 canonical)
    projections.md              ← Multi-macro library doc demonstrating OQ #30/#31 named-block addressing
  Meta/Skills/
    using-macros-in-skills.md   ← Meta-skill teaching macro conventions
  Sample-Skills/
    do-web-research-pattern1.md ← Inline macro at point of invocation
    do-web-research-pattern2.md ← Referenced via source_ref + explicit prose
    do-web-research-pattern3.md ← {{ref}} + inputs (compact form)
```

## What each artifact demonstrates

### `Macros/research-batch.md`

A *single-macro library* doc with the resolved convention:

- `type: macro_library` frontmatter (per OQ #30 — marks the doc as a macro library, distinct from skill docs)
- Usage section with the explicit invocation instruction
- Expected inputs section (the `input_vars` contract)
- Returns section (the shape of the `exit` value)
- The fenced `fqm name=research_batch` block containing the macro source

This is the artifact Pattern 3 skills reference via `{{ref:...}}` to inline
the doc body, AND the artifact Pattern 2 skills reference via `source_ref`
when calling `call_macro`. The same doc works for both patterns.

### `Macros/projections.md`

A *multi-macro library* doc demonstrating OQ #30's named-block addressing
and OQ #31's `::` separator:

- Same `type: macro_library` frontmatter
- Three named macros in one doc: `add_projections`, `remove_projections`, `list_projections`
- Each block is addressable via `source_ref: "Macros/projections.md::<name>"`
- Demonstrates the convention where one doc encapsulates a related family of macros

### `Meta/Skills/using-macros-in-skills.md`

The meta-skill that teaches LLMs how to interpret macro-using skills:

- The three embedding patterns and when to use each
- The function-call contract (`input_vars` IN, `exit` OUT)
- Control-flow expectations after `call_macro` returns (LLM stays in its turn)
- The verbatim-source instruction for Pattern 1
- Common pitfalls

Skill authors writing macro-using skills should reference this meta-skill
so the LLM has the conventions loaded into context.

### `Sample-Skills/do-web-research-pattern{1,2,3}.md`

Three variants of the same "do web research on a topic" workflow, each
demonstrating one embedding pattern against the `research-batch` macro.
Side-by-side, they show the trade-offs between patterns and let skill
authors pick the one that fits their use case.
