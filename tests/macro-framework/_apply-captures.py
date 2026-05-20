#!/usr/bin/env python3
"""
Apply captures: reads /tmp/captures.json (output of
_generic-capture-runner.ts) and surgically updates each pilot YAML's
reconciliation + golden_snapshot blocks. Preserves comments and
formatting outside the two updated blocks.

Comparison logic:
  - If `predicted_expect` exists, compare it to the captured envelope
  - Otherwise fall back to comparing `expect` to the captured envelope
  - Sets reconciliation.predicted_matched_captured: true|false
  - Sets reconciliation.captured_at: <current ISO>
  - Sets reconciliation.divergence_kind: clean_match | predicted_diverges_from_golden
  - Adds/updates golden_snapshot block with captured_trace_kinds and
    captured_tool_calls

Usage:
  python3 tests/macro-framework/_apply-captures.py /tmp/captures.json
"""

import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

try:
    import yaml
except ImportError:
    print("pyyaml required", file=sys.stderr); sys.exit(2)


def normalize(v):
    if v is None: return None
    if isinstance(v, dict): return {k: normalize(v[k]) for k in v if v[k] is not None}
    if isinstance(v, list): return [normalize(x) for x in v]
    return v


def compare(prediction, captured):
    """Return (matched_bool, divergence_summary | None).

    Honors `comparison: match_some` per the framework runner's semantics
    (see runner.ts compareToExpect): under match_some, ≥1 declared expect
    field matching the capture is sufficient to mark the pilot as a clean
    match. Without this, intentional-mismatch self-tests (e.g.,
    cases/errors/_intentional-mismatch-fake-expected-result.yml) would
    always read as divergent here even though the framework runner
    correctly passes them.
    """
    if not prediction:
        return False, "no prediction to compare against"
    cap_err = captured.get("error")
    cap_ret = captured.get("return")
    cap_outcome = "error" if cap_err else "success"
    pred_outcome = prediction.get("outcome")
    # Older pilots use 'fail' or 'parse_error' as outcome; treat any non-success as 'error'
    pred_outcome_normalized = "success" if pred_outcome == "success" else "error"
    mode = prediction.get("comparison", "match_all")

    # Collect per-field findings rather than short-circuiting; match_some
    # needs to know whether ANY field matched, not just whether the first
    # one did.
    matches = []
    findings = []

    if pred_outcome_normalized == cap_outcome:
        matches.append("outcome")
    else:
        findings.append(f"outcome divergence: predicted={pred_outcome}, captured={cap_outcome}")

    if cap_outcome == "success":
        # Only compare return_result if the prediction declared one.
        if "return_result" in prediction:
            pred_ret = prediction.get("return_result")
            if normalize(pred_ret) == normalize(cap_ret):
                matches.append("return_result")
            else:
                findings.append("return_result divergence")
    else:
        pred_err = prediction.get("error") or {}
        pred_code = pred_err.get("code")
        cap_code = (cap_err or {}).get("code")
        if pred_code and cap_code:
            if pred_code == cap_code:
                matches.append("error.code")
            else:
                findings.append(f"error.code divergence: predicted={pred_code}, captured={cap_code}")

    if mode == "match_some":
        if matches:
            return True, None
        return False, "; ".join(findings) if findings else "no fields matched under match_some"
    # Default match_all: any finding is a divergence.
    if findings:
        return False, "; ".join(findings)
    return True, None


def build_reconciliation_block(matched, divergence, captured_iso, tool_calls, trace_kinds):
    """Build the new reconciliation + golden_snapshot YAML text."""
    dk = "clean_match" if matched else "predicted_diverges_from_golden"
    pmc = "true" if matched else "false"
    notes = ("Clean three-oracle reconciliation. Captured by generic capture runner.\n"
             if matched else f"Divergence detected by generic capture runner: {divergence}\n")
    rec = (
        "reconciliation:\n"
        f"  predicted_matched_captured: {pmc}\n"
        f"  captured_at: \"{captured_iso}\"\n"
        f"  golden_version: \"0.3.0\"\n"
        f"  divergence_kind: {dk}\n"
        f"  notes: |\n"
        f"    {notes.rstrip()}"
        "\n"
    )
    # Build golden_snapshot block
    tc_lines = []
    for tc in tool_calls:
        tc_lines.append(f"    - server: \"{tc['server']}\"\n      tool: \"{tc['tool']}\"")
    tc_block = "\n".join(tc_lines) if tc_lines else "  captured_tool_calls: []"
    if tc_lines:
        gs = (
            "golden_snapshot:\n"
            f"  captured_trace_kinds: {json.dumps(trace_kinds)}\n"
            "  captured_tool_calls:\n" + tc_block + "\n"
        )
    else:
        gs = (
            "golden_snapshot:\n"
            f"  captured_trace_kinds: {json.dumps(trace_kinds)}\n"
            "  captured_tool_calls: []\n"
        )
    return rec, gs


def replace_block(text, block_name, new_text):
    """Replace `<block_name>:\\n  ... lines ...` block with new_text.

    Looks for the block at the top level (no leading whitespace before
    `<block_name>:`), and replaces from that line up to (but not including)
    the next top-level key or EOF.
    """
    # Find the block start
    pattern = rf"(^{re.escape(block_name)}:.*?\n)((?:[ \t]+.*\n|\n)*)"
    m = re.search(pattern, text, flags=re.MULTILINE)
    if not m:
        # Block doesn't exist — append at end (before final newline if any)
        if not text.endswith("\n"):
            text += "\n"
        return text + new_text
    # Replace the block
    return text[:m.start()] + new_text + text[m.end():]


def main():
    if len(sys.argv) < 2:
        print("Usage: _apply-captures.py <captures.json>", file=sys.stderr)
        sys.exit(2)
    with open(sys.argv[1]) as f:
        captures = json.load(f)

    captured_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    matched_count = 0
    divergent_count = 0
    skipped_count = 0
    divergent_paths = []

    for c in captures:
        if not c.get("ok"):
            skipped_count += 1
            continue
        path = Path(c["path"])
        with open(path) as f:
            text = f.read()
        doc = yaml.safe_load(text)
        cap = c["capture"]
        prediction = doc.get("predicted_expect") or doc.get("expect")
        matched, divergence = compare(prediction, cap)
        rec_block, gs_block = build_reconciliation_block(
            matched,
            divergence,
            captured_iso,
            cap["captured_tool_calls"],
            cap["trace_kinds"],
        )

        new_text = text
        new_text = replace_block(new_text, "reconciliation", rec_block)
        new_text = replace_block(new_text, "golden_snapshot", gs_block)
        # If there was no expect block, this won't add one; we don't touch expect.

        with open(path, "w") as f:
            f.write(new_text)

        if matched:
            matched_count += 1
        else:
            divergent_count += 1
            divergent_paths.append((str(path).split("cases/")[-1], divergence))

    print(f"Applied to {matched_count + divergent_count} pilots:")
    print(f"  Match:     {matched_count}")
    print(f"  Divergent: {divergent_count}")
    print(f"  Skipped:   {skipped_count}")
    if divergent_count:
        print()
        print("Divergent pilots (first 20):")
        for p, d in divergent_paths[:20]:
            print(f"  {p}: {d}")


if __name__ == "__main__":
    main()
