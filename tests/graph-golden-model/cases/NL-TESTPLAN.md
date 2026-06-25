# NL test plan — remaining angles

A walkthrough plan for the natural-language (LLM-as-judge) testing we still want to do
before returning to the enum/indicator set. Work the phases in order. **Annotate findings
inline** under each item as we go (what passed, what broke, what we changed, and why).

Status: ☐ todo · ◐ in progress · ☑ done
Each item: what to test → expected behavior → cases to add → **Findings**.

> Why this order: Phase 1 first because everything downstream depends on trusting the
> judge; then the faithfulness battery (where extraction silently corrupts meaning); then
> precision / edge-reasoning / cross-output; scale last. Agreed sequence: 1, 2, 3–5, 6.

---

## Already learned (first long-passage pass, 2026-06-25)

Carry-over context so we don't relearn it:

- Long input made `key_claims` **over-generate** (empty strings, nested arrays → strict-parse
  failure). Fix: node template requires a FLAT array of non-empty strings, consolidated (3–10).
- Long input made the model **under-capture** (dropped the consequence half of compound facts).
  Fix: completeness nudge (keep consequences/deadlines/conditions/comparatives).
- Judge over-split **comparatives** as non-atomic. Fix: sharpened the `atomic` criterion
  (a comparison or fact+consequence = one fact); non-atomic negative control still fails.
- `must_capture` facts must themselves be **atomic**, or they conflict with the atomic criterion.
- These claim-prompt edits live in the SHARED `analyze_node` prompt → re-confirm the enum node
  suite after, and consider splitting per-field guidance later.

---

## Phase 1 — Harden the judge on SUBTLE errors  ☑ (2026-06-25, gemma4)

The judge is only proven on blatant errors. LLM-judges fail on small distortions, so this
gates trust in everything else. Use `given`-mode controls (feed a subtly-wrong output, assert
the judge marks the right criterion **fail**). All against a faithful source passage.

**Result: all 6 controls pass — the judge caught every subtle distortion AND accepted the
faithful paraphrase. No criterion refinement needed. Exit criterion MET.** Cases:
`nl-judge-subtle-*`.

- ☑ **Unit/scale slip** (40ms→40s) → `grounded`=fail. *"output states '40 seconds' while the source specifies '40 milliseconds'."*
- ☑ **Flipped direction** (lowered→raised, 800↔480) → `faithful`=fail. *"source states lowered latency, output claims raised."*
- ☑ **Quantifier/modal swap** (all/must→some/may) → `faithful`=fail. *"source: all callers must; output: some callers may."*
- ☑ **Meaning-changing paraphrase** (drops the "only when…" condition → "always improves") → `faithful`=fail.
  - ☑ **Positive control** — faithful paraphrase ("lowered"→"reduced", same numbers) → grounded+faithful pass. No over-rejection.
- ☑ **Dropped negation** ("decided NOT to adopt" → "decided to adopt") → `faithful`=fail.

**Takeaway:** gemma4-as-judge is reliable on subtle errors, not just blatant ones, with crisp
reasons. `grounded` catches unsupported/altered VALUES; `faithful` catches distortions of
direction/strength/polarity/scope. We can trust it for Phases 2–6.

**Phase 1 exit criterion:** judge catches every subtle control AND passes the faithful
positive control. ✓ met.

---

## Phase 2 — Faithfulness / precision battery (extraction)  ☑ (2026-06-25, gemma4)

Real passages + atomic `must_capture` that pin the nuance. Tests that extraction preserves
meaning, not just gist. **Result: all 6 pass (after one prompt fix). Cases `nl-claims-phase2-*`.**

- ☑ **Negation / polarity** — 10/10. All "did not …" negatives preserved verbatim.
- ☑ **Numeric / date / unit fidelity** — 11/11 AFTER a fix. First run FAILED: on the
  number-dense passage gemma4 emitted a stray empty-string element and let `chunk_summary`
  bleed into an unclosed `key_claims` array (jsonrepair then mangled it → phantom number/array
  entries). Root cause was JSON well-formedness, not over-generation (the 6 claims were good).
  **Fix:** node template now demands "exactly ONE well-formed JSON object: close every array
  and string, no empty-string element, no field bleeding into another's array." → 11/11, every
  figure exact (1.2M, 4,800/s, 120ms, 1.4s, 0.1%, 0.04%).
- ☑ **Hedging preservation** — 8/8. Kept "most likely" and "not yet confirmed"; did not assert as settled.
- ☑ **Attribution** — 10/10. Preserved who proposed / objected / reviewed / deferred.
- ☑ **Conditionals / scope** — 9/9. Kept "only when CPU > 70% for 5 min", "only annual prepay", "only after reconnect".
- ☑ **Hallucination bait** — 9/9. Stuck to the 3 stated API facts; added no known-but-unstated lore.

---

## Phase 3 — Precision / over-extraction control  ☑ (2026-06-25, gemma4)

We've tested recall hard; barely tested precision. Added harness: `max_claims` / `min_claims`.

- ☑ **Distractor / noise rejection** — 9/9 (after a JUDGE fix). Extraction was perfect: 3 real
  facts, zero marketing fluff, within `max_claims`. But the judge's `complete` **false-failed**
  with a factually wrong reason ("omits the free tier" — it was claim 1). Real finding: `complete`
  is the judge's weakest criterion (can hallucinate omissions, worse amid fluff). **Fix:** sharpened
  `complete` (ignore marketing/opinion/filler; re-read the output before failing; name the missing
  fact). Distractor → 9/9; the `nl-judge-incomplete` negative control still fails. ✓
- ☑ **Claim-free input** — 4/4. No fabrication: on a greeting+question it produced 2 grounded
  meta-claims *about the message* (within `max_claims`), not invented facts.

## Phase 4 — Edge `reasoning` judging  ☑ (2026-06-25, gemma4)

Harness: `judge_reasoning: [...]` on an edge case judges the primary edge's NL reasoning, using
the source/target claims + chosen relation as the reference. Case `edge-reasoning-supports`.

- ☑ 6/6 after fitting criteria to reasoning. First run failed: generic `grounded` ("source text")
  misfired because the reference has SEPARATE source/target claim sets — it flagged a target-claim
  term as "not in source". And `justifies` over-demanded a causal "mechanism". **Fixes:** use
  `consistent` (whole-reference) for grounding reasoning, and softened `justifies` (plausible
  rationale fitting the claims; no mechanism required). Verdicts now consistent=pass, justifies=pass.
  - Finding: reasoning needs reasoning-appropriate criteria, not the claim/summary ones.

## Phase 5 — Cross-output consistency (harness addition)  ☑ (2026-06-25, gemma4)

Harness: `against: key_claims` makes the judge use the model's OWN extracted claims as the
reference; new `consistent` criterion. Case `nl-consistency-deprecation`.

- ☑ 3/3. The extracted summary asserts nothing beyond the extracted claims. Cross-output judging
  works. TODO: a negative control (force an over-asserting summary) is hard to elicit — revisit.

---

## Phase 6 — Scale / position bias  ☑ (2026-06-25, gemma4)

- ☑ **Long document** (10 paragraphs, ~14 distinct facts) — 11/11. No position bias: the model
  captured facts from across the doc INCLUDING all three final-paragraph facts (Postgres behind
  schedule, weekend on-call understaffed, hiring-freeze revisit). It scaled to **14 claims**,
  correctly exceeding the soft "typically 3-10" guidance — the completeness nudge wins over the
  count hint, so long docs aren't truncated. (Caveat: tested at ~10 paragraphs; much longer docs
  may still need re-checking. Extraction on long input is slow — used cache-resume.)
  - Note: with `atomic` omitted here, one claim bundled GA+adoption+target; fine for the
    completeness focus, but a reminder that very-long-doc atomicity is untested.

## Structural nice-to-haves (do if cheap)  ☐

- ☐ **Enumerations** — "three things: a, b, c" → all three, atomic.
  - Findings:
- ☐ **Self-contradiction within a passage** — does extraction surface both sides? (feeds downstream contradiction detection)
  - Findings:

---

## Cross-cutting learnings log

Add dated, durable insights here as they emerge (prompt rules, harness changes, judge-criteria
refinements) — the ones worth porting back or remembering:

- 2026-06-25: (seed) see "Already learned" above.
- 2026-06-25: Phase 1 done — gemma4-as-judge catches subtle distortions (unit/scale, flipped
  direction, quantifier/modal, condition-drop, dropped negation) and accepts faithful
  paraphrase. Division of labor: `grounded` = unsupported/altered VALUES; `faithful` =
  distortions of direction/strength/polarity/scope. Judge is trusted for downstream phases.
- 2026-06-25: Phase 2 done — extraction preserves negation, exact numbers/units, hedging,
  attribution, and conditions, and resists hallucination. Only failure was JSON well-formedness
  on a number-dense passage (stray empty element + unclosed array). Hardened the node prompt to
  require one well-formed object. Per Matt: this is the class of issue we EXPECT larger models to
  not exhibit — gemma4 is the floor, so hardening here is no-downside and strong models clear it.
- 2026-06-25: Phases 3-5 done. Precision is good (no fluff extracted; claim-free → grounded
  meta-claims, not fabrication). Key learnings: (a) `complete` is the JUDGE's weakest criterion —
  it can hallucinate omissions, esp. amid marketing fluff; sharpened its definition (ignore
  fluff, re-read output before failing) and the incomplete control still fails. (b) Edge reasoning
  needs reasoning-specific judge criteria — `grounded` ("source text") misfits a source+target
  reference; use `consistent` + a softened `justifies` (no causal-mechanism demand). (c) New
  harness: `max_claims/min_claims` (precision), `against: key_claims` (cross-output consistency),
  `judge_reasoning` on edge cases. All judge-criteria changes are workbench-only (no prod change).
- 2026-06-25: Phase 6 done — no position bias at ~10-paragraph scale; the model scaled to 14
  claims (past the soft 3-10 hint) and kept all late-paragraph facts. Completeness nudge beats
  the count hint, so long docs aren't truncated. **Phases 1-6 complete.** Remaining: the two
  structural nice-to-haves (enumerations, self-contradiction) and a cross-output negative control.
