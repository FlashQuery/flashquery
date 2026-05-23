# Workflow: Resolve (open-question responses)

When a finding carries an **Open question** — a product-behavior decision the
audit could not make on its own — Matt answers it by writing a comment directly
under the OQ in the findings document. The Resolve workflow reads those comments,
folds each decision into the finding's actual work, restates the OQ as resolved,
and logs the change in the finding's Audit history.

This is an on-demand workflow. It runs after `Report` (and usually after
`Verify`), whenever Matt has gone through the findings and commented on open
questions. It can be run repeatedly as he works through them.

## How Matt's comments look

Matt writes his answer immediately below the OQ block (below the Q / Options /
Recommendation lines). The label varies — "Matt's comment", "Comment",
"Comments", "Response", "Matt:", or similar. Treat any author comment in that
position as a response to that OQ. An OQ with no comment under it is still
open — leave it untouched.

## Steps

1. **Locate the findings document(s).** `Findings.md` (or the split
   `Findings — *.md` files) in the audit's output folder. Ask the user which
   audit folder if it is not obvious. If the user names a specific finding
   (e.g. "resolve the open question on FQ-AUDIT-0003"), process just that one.
2. **Scan for answered OQs.** Find every finding whose `Open questions` field
   has an OQ with a Matt comment beneath it. Skip OQs with no comment.
3. **For each answered OQ:**

   a. Read the OQ (Q / Options / Recommendation) and Matt's comment together.
      Determine the decision: which option he chose, or the alternative
      instruction he gave. His comment is authoritative — it overrides the
      audit's Recommendation; he is the product-decision authority.

   b. **If the comment is a clear decision — fold it in.** Update the finding's
      **Remediation** so it states the chosen behavior concretely, not "apply
      the choice from Q1". Update any other field the decision affects —
      *New tests needed*, *Severity*, *Risk of fix*, *Dependencies / ordering* —
      so the finding is internally consistent with the decision. The finding
      must read as though the question had never been open.

   c. **Resolve the OQ.** Replace the answered OQ with its resolved form
      (below): remove Matt's raw comment and the Options / Recommendation menu,
      and restate the question and the decision in two short lines. The detail
      now lives in *Remediation*; the resolved OQ is only the record that the
      question was raised and how it was settled.

   d. **Log it in Audit history.** Append one line to the finding's
      `**Audit history**` block (see Part 7 of `references/output-template.md`):

      ```markdown
      - [YYYY-MM-DD] — Resolve ([Model name]): resolved OQ Q1 — [one-line
        decision summary]; folded into remediation.
      ```

   e. **If the comment is NOT a clear decision** — it asks a counter-question,
      is ambiguous, or raises a new concern — do not force a resolution and do
      not delete his comment. Leave the OQ open and the comment in place, and
      surface it back to Matt in your closing summary so he can answer again.

4. **Re-gate the finding.** When a finding's last OQ is resolved it has no
   remaining `Open questions`; per Part 6 of `references/output-template.md` it
   is now ready for a fix-agent. A finding that still has an unresolved OQ stays
   gated.

5. **Update `Audit Summary.md`.** Add one line to the document-level Audit
   history section: `[date] — Resolve ([Model name]): resolved N open questions
   across M findings.`

## The resolved-OQ form

Replace the answered OQ with this — keep it compact; it is a record, not the
work:

```markdown
**Open question (resolved [DD-MMM-YYYY])**
- **Q1:** [the question, restated in one line]
  - **Decision:** [the decision, stated concisely — what the fix should do]
```

Matt's raw comment, the Options list, and the Recommendation line are removed.
The decision itself lives in **Remediation**.

## Output

The updated findings document(s) — decisions folded into remediation, answered
OQs in resolved form, Audit history lines appended — and the document-level line
in `Audit Summary.md`. In your closing summary to Matt, list which OQs were
resolved, and call out any comment you could not resolve (step 3e) so he can act
on it.
