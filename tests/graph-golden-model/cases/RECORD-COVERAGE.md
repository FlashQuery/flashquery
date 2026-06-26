# Record-kind coverage matrix

The conditions the **record** suite must stress before we push the prompts to production. Each row is
a production-faithful scenario; a record case checks EVERY field, so one case covers many cells, but we
want each *condition* deliberately exercised. Status: ✅ has a passing record case · ◑ partial/known
gap · ◻ not yet authored. Keep this in sync as cases are added (it is the record analogue of
`COVERAGE.md`, which tracks the facet suite).

## Node (`analyze_node`) conditions

| Condition | Case(s) | Status |
| --- | --- | --- |
| certainty high (ratified/settled) | deprecation, standard-refs, temporal-formats | ✅ |
| certainty medium (cue words: likely/preliminary) | certainty-medium | ✅ |
| certainty low (speculation/proposal) | certainty-low | ✅ |
| certainty unknown | — (open Q §12.1) | ◻ |
| staleness high (deadline/version cutover) | deprecation, ext-deprecation-notice, temporal-formats | ✅ |
| staleness medium (drifting count/status) | dataset-provenance | ✅ |
| staleness low (durable definition/concept) | durable-definition, ext-arxiv | ✅ |
| staleness unknown | — | ◻ |
| question_status null (plain fact) | most node cases | ✅ |
| question_status open | question-open | ✅ |
| question_status deferred | question-deferred | ✅ |
| question_status resolved (+ resolution text) | question-resolved | ✅ |
| provenance present — RFC/decision ratified | deprecation, standard-refs | ✅ |
| provenance present — dataset/survey "according to" | dataset-provenance | ✅ |
| provenance null — self-contained | durable-definition, certainty-* | ✅ |
| provenance — "defined in RFC" / internal source | ext-rfc-headers, ext-prd-cart | ◑ (borderline-null; product call) |
| external_refs — RFC/standard numbers | standard-refs | ✅ |
| external_refs — named doc/dataset/survey | dataset-provenance | ✅ |
| external_refs — API paths / product+version names | temporal-formats, ext-deprecation-notice | ◑ (improved via few-shot; verify) |
| external_refs — URLs / ticket IDs | — | ◻ |
| external_refs empty | durable-definition | ✅ |
| temporal_markers — dates/quarters/relative/duration | temporal-formats | ✅ |
| temporal_markers — semantic versions | temporal-formats | ◑ (v3.0 caught; a 2nd embedded version missed) |
| temporal_markers empty | durable-definition | ✅ |
| key_claims — atomic splitting of enumerations | — (facet only) | ◻ |
| key_claims — fact+consequence / comparative kept whole | — (facet only) | ◻ |
| chunk_summary — representative + concise | most node cases | ✅ |
| reasoning — format/length (1-2 sentences, not judged) | temporal-formats | ✅ |
| input variety — external (PRD/arXiv/RFC/changelog) | ext-prd-cart, ext-arxiv, ext-rfc-headers, ext-deprecation-notice | ✅ |
| input variety — postmortem / ADR / news | — | ◻ |
| dense multi-fact chunk (summary tension) | ext-deprecation-notice | ◑ |
| fact + opinion/marketing mix (ignore fluff) | — | ◻ |

## Edge (`classify_edge`) conditions

| Condition | Case(s) | Status |
| --- | --- | --- |
| relation supports | edge-supports | ✅ |
| relation contradicts | edge-contradicts | ✅ |
| relation supersedes | edge-supersedes | ✅ |
| relation depends_on | edge-depends-on | ✅ |
| relation elaborates | edge-elaborates | ✅ |
| relation duplicates | edge-duplicates | ◻ |
| relation summarizes | edge-summarizes | ◻ |
| relation rationale_for | edge-rationale-for | ◻ |
| relation extends | edge-extends | ◻ |
| relation resolves | edge-resolves | ◻ |
| no-edge negative (unrelated pair) | edge-none | ◻ |
| multi-edge (two relations from one pair) | — | ◻ |
| confounder supports vs elaborates | edge-elaborates (`*_in`) | ◑ |
| confounder summarizes vs duplicates | — | ◻ |
| qualifier conditional | edge-conditional | ✅ |
| qualifier temporal | edge-temporal-qualifier | ✅ |
| qualifier uncertainty + propagation to assessment/confidence | edge-uncertainty-weak | ✅ |
| confidence high for clear strong link | edge-supports/contradicts | ✅ |
| confidence low for hedged/weak link (confidence_max) | edge-uncertainty-weak | ✅ |
| reasoning justifies (relation rationale) | all edge cases | ✅ |

## Gaps filled (2026-06-26)
- duplicates ✅, summarizes ✅, rationale_for ✅, resolves ✅, no-edge negative ✅, multi-edge ✅
  (edge-multi, primary supersedes within 1–3 edges); external_refs URLs/tickets ✅ (ext-urls-tickets);
  ADR/decision-record input ✅ (decision-record).

## Known non-prompt residuals (don't chase as prompt bugs)
- **Relation calibration is the dominant remaining theme.** gemma4 **over-selects `supports`/`elaborates`**
  among confusable siblings: elaborates→supports, conditional→elaborates, extends→elaborates,
  summarizes/duplicates→supports, and a hedged agreement→contradicts. The relations are genuinely
  confusable and `classify_edge` is near the model's complexity ceiling (§9.6); this is a
  model-capability axis (candidate for a stronger graph model), not a clean prompt bug. Cases use
  `primary_relation_in` where defensible.
- `reasoning.justifies` on terse edge reasoning is a JUDGE-model ceiling — depends_on/resolves/supersedes
  PASS under `--judge-model nemotron3:33b`; not a graph-prompt issue.
- `question_status=resolved` for a DECLARATIVELY-stated decision ("we decided X", no "?") is a gemma4
  ceiling (decision-record); a one-shot did not move it.
- `temporal_markers` second embedded semantic version occasionally dropped (capability residual).
- `provenance` product calls RESOLVED (2026-06-26): internal sources DO count (prompt broadened;
  prd-cart now captures "post-checkout surveys" ✅); a definition's subject is NOT provenance ("X is
  defined in RFC Y" → null; rfc-headers now passes ✅). Both folded into the prompt + PORT_BACK #20.
