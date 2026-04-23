#!/usr/bin/env python3
"""
Test: Reconciliation modification and field sync — on_modified: sync-fields re-applies
      field_map from current frontmatter; on_modified: ignore takes no action and still
      updates last_seen_updated_at to prevent repeated re-evaluation.

Scenario:
    Plugin A (on_modified: sync-fields):
        A1. Create doc with author/priority frontmatter → auto-track → verify initial fields (RO-28 setup)
        A2. Modify frontmatter on disk → scan → wait 32s → reconcile → verify sync-fields fired (RO-28)
        A3. Remove 'author' key from frontmatter → scan → wait 32s → reconcile → verify NULL (RO-59)

    Plugin B (on_modified: ignore):
        B1. Create doc with label frontmatter → auto-track → verify initial label (RO-29 setup)
        B2. Modify label on disk → scan → wait 32s → reconcile → verify NO sync (RO-29)
        B3. Wait 32s → reconcile again → verify doc is 'unchanged' (not re-triggered) (RO-30)

Coverage points: RO-28, RO-29, RO-30, RO-59

Modes:
    Default     Connects to an already-running FlashQuery instance (config from flashquery.yml)
    --managed   Starts a dedicated FlashQuery subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_reconciliation_modification.py                            # existing server
    python test_reconciliation_modification.py --managed                  # managed server
    python test_reconciliation_modification.py --managed --json           # structured JSON with server logs
    python test_reconciliation_modification.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-28", "RO-29", "RO-30", "RO-59"]

import argparse
import json as _json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_modification"
PLUGIN_A_ID = "recon_mod_a"
PLUGIN_B_ID = "recon_mod_b"
DOC_TYPE_A_ID = "mod_note_a"
DOC_TYPE_B_ID = "mod_item_b"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml_a(folder: str) -> str:
    """Plugin A: on_modified: sync-fields — re-applies field_map on modification."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_A_ID}\n"
        "  name: Reconciliation Modification Test Plugin A\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for sync-fields modification mechanics\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Auto-tracked notes with sync-fields on modification\n"
        "    columns:\n"
        "      - name: author\n"
        "        type: text\n"
        "      - name: priority\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_A_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_modified: sync-fields\n"
        "      field_map:\n"
        "        author: author\n"
        "        priority: priority\n"
    )


def _build_schema_yaml_b(folder: str) -> str:
    """Plugin B: on_modified: ignore — no field sync on modification."""
    return (
        "plugin:\n"
        f"  id: {PLUGIN_B_ID}\n"
        "  name: Reconciliation Modification Test Plugin B\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for ignore-modification mechanics\n"
        "\n"
        "tables:\n"
        "  - name: items\n"
        "    description: Auto-tracked items with ignore on modification\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_B_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: items\n"
        "      on_modified: ignore\n"
        "      field_map:\n"
        "        label: label\n"
    )


def _extract_first_record(text: str) -> dict:
    """Parse the first record from a search_records response (JSON array)."""
    # Response format: "Found N record(s):\n[...json array...]..."
    # Bracket-count to handle nested objects without splitting on nested brackets.
    start = text.find("[")
    if start == -1:
        return {}
    depth = 0
    end = start
    for i, ch in enumerate(text[start:], start):
        if ch == "[":
            depth += 1
        elif ch == "]":
            depth -= 1
            if depth == 0:
                end = i
                break
    try:
        records = _json.loads(text[start : end + 1])
        return records[0] if isinstance(records, list) and records else {}
    except _json.JSONDecodeError:
        return {}


def _extract_recon_summary(text: str) -> str:
    """Extract the reconciliation summary from a tool response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


def _write_frontmatter_direct(ctx, vault_path: str, frontmatter_dict: dict, body: str) -> None:
    """Write frontmatter directly to disk using yaml.dump + tmp-rename pattern.

    This is required when we need to remove keys — write_frontmatter() merges
    updates and cannot delete keys.
    """
    import yaml
    from datetime import datetime, timezone
    # Update the 'updated' timestamp so the scanner detects a change
    frontmatter_dict["fq_updated"] = (
        datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
        + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
    )
    fm_yaml = yaml.dump(frontmatter_dict, default_flow_style=False, sort_keys=False, allow_unicode=True)
    new_content = f"---\n{fm_yaml}---\n\n{body}"
    abs_path = ctx.vault.vault_root / vault_path
    tmp_path = abs_path.with_name(abs_path.name + ".fqc-tmp")
    tmp_path.write_text(new_content, encoding="utf-8")
    tmp_path.rename(abs_path)


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_a = f"test_a_{run.run_id[:8]}"
    instance_b = f"test_b_{run.run_id[:8]}"
    folder_a = f"_test_recon_mod_a/{run.run_id[:8]}"
    folder_b = f"_test_recon_mod_b/{run.run_id[:8]}"

    schema_yaml_a = _build_schema_yaml_a(folder_a)
    schema_yaml_b = _build_schema_yaml_b(folder_b)

    doc_a_path = f"{folder_a}/mod-note-{run.run_id[:8]}.md"
    doc_b_path = f"{folder_b}/mod-item-{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_a_registered = False
    plugin_b_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register Plugin A (sync-fields) ───────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_a = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml_a,
            plugin_instance=instance_a,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_a.expect_contains("registered successfully")
        reg_a.expect_contains(instance_a)
        reg_a.expect_contains("notes")

        run.step(
            label="register Plugin A (on_modified: sync-fields, field_map: author+priority)",
            passed=(reg_a.ok and reg_a.status == "pass"),
            detail=expectation_detail(reg_a) or reg_a.error or "",
            timing_ms=reg_a.timing_ms,
            tool_result=reg_a,
            server_logs=step_logs,
        )
        if not reg_a.ok:
            return run
        plugin_a_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_A_ID, instance_a)

        # ── Step 2: Register Plugin B (ignore) ───────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        reg_b = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml_b,
            plugin_instance=instance_b,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        reg_b.expect_contains("registered successfully")
        reg_b.expect_contains(instance_b)
        reg_b.expect_contains("items")

        run.step(
            label="register Plugin B (on_modified: ignore, field_map: label)",
            passed=(reg_b.ok and reg_b.status == "pass"),
            detail=expectation_detail(reg_b) or reg_b.error or "",
            timing_ms=reg_b.timing_ms,
            tool_result=reg_b,
            server_logs=step_logs,
        )
        if not reg_b.ok:
            return run
        plugin_b_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_B_ID, instance_b)

        # ── Step 3: Create doc for Plugin A ───────────────────────────────────
        ctx.create_file(
            doc_a_path,
            title=f"Modification Note {run.run_id[:8]}",
            body=f"## Modification Test (Plugin A)\n\nBody for {TEST_NAME}.\nOnly frontmatter changes.",
            tags=["fqc-test", "recon-mod"],
            extra_frontmatter={
                "author": "Alice",
                "priority": "high",
            },
        )
        ctx.cleanup.track_dir(folder_a)
        ctx.cleanup.track_dir("_test_recon_mod_a")

        run.step(
            label="create Plugin A doc with author=Alice, priority=high",
            passed=True,
            detail=f"Created: {doc_a_path}",
        )

        # ── Step 4: Create doc for Plugin B ───────────────────────────────────
        ctx.create_file(
            doc_b_path,
            title=f"Modification Item {run.run_id[:8]}",
            body=f"## Modification Test (Plugin B)\n\nBody for {TEST_NAME}.\nOnly frontmatter changes.",
            tags=["fqc-test", "recon-mod"],
            extra_frontmatter={
                "label": "original-value",
            },
        )
        ctx.cleanup.track_dir(folder_b)
        ctx.cleanup.track_dir("_test_recon_mod_b")

        run.step(
            label="create Plugin B doc with label=original-value",
            passed=True,
            detail=f"Created: {doc_b_path}",
        )

        # ── Step 5: Scan to index both docs ───────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan1 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — index both docs into fqc_documents",
            passed=scan1.ok,
            detail=scan1.error or "",
            timing_ms=scan1.timing_ms,
            tool_result=scan1,
            server_logs=step_logs,
        )
        if not scan1.ok:
            return run

        # ── Step 6: Reconcile Plugin A — auto-track (prime the staleness cache) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_a = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_A_ID,
            plugin_instance=instance_a,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime_a.expect_contains("Auto-tracked")

        run.step(
            label="search_records Plugin A — auto-tracks doc A; seeds staleness cache",
            passed=(prime_a.ok and prime_a.status == "pass"),
            detail=expectation_detail(prime_a) or prime_a.error or "",
            timing_ms=prime_a.timing_ms,
            tool_result=prime_a,
            server_logs=step_logs,
        )
        if not prime_a.ok:
            return run

        # ── Step 7: Verify initial field values for Plugin A (RO-28 setup) ───
        t0 = time.monotonic()
        record_a_initial = _extract_first_record(prime_a.text)

        checks_init_a = {
            "record present in Plugin A response": bool(record_a_initial),
            "author=Alice (initial)": record_a_initial.get("author") == "Alice",
            "priority=high (initial)": record_a_initial.get("priority") == "high",
        }
        all_ok = all(checks_init_a.values())
        detail_parts = []
        if not all_ok:
            failed = [k for k, v in checks_init_a.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"author={record_a_initial.get('author')!r}, priority={record_a_initial.get('priority')!r}"
        )

        run.step(
            label="verify Plugin A initial field values (author=Alice, priority=high)",
            passed=all_ok,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok:
            return run

        # ── Step 8: Reconcile Plugin B — auto-track (prime staleness cache) ──
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_b = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_B_ID,
            plugin_instance=instance_b,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime_b.expect_contains("Auto-tracked")

        run.step(
            label="search_records Plugin B — auto-tracks doc B; seeds staleness cache",
            passed=(prime_b.ok and prime_b.status == "pass"),
            detail=expectation_detail(prime_b) or prime_b.error or "",
            timing_ms=prime_b.timing_ms,
            tool_result=prime_b,
            server_logs=step_logs,
        )
        if not prime_b.ok:
            return run

        # ── Step 9: Verify initial field values for Plugin B (RO-29 setup) ───
        t0 = time.monotonic()
        record_b_initial = _extract_first_record(prime_b.text)

        checks_init_b = {
            "record present in Plugin B response": bool(record_b_initial),
            "label=original-value (initial)": record_b_initial.get("label") == "original-value",
        }
        all_ok = all(checks_init_b.values())
        detail_parts = []
        if not all_ok:
            failed = [k for k, v in checks_init_b.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(f"label={record_b_initial.get('label')!r}")

        run.step(
            label="verify Plugin B initial field values (label=original-value)",
            passed=all_ok,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok:
            return run

        # ── Step 10: Modify Plugin A doc frontmatter on disk (author→Bob, priority→medium) ──
        t0 = time.monotonic()
        try:
            doc_a_disk = ctx.vault.read_file(doc_a_path)
            fm_a = dict(doc_a_disk.frontmatter)
            fm_a["author"] = "Bob"
            fm_a["priority"] = "medium"
            _write_frontmatter_direct(ctx, doc_a_path, fm_a, doc_a_disk.body)

            # Verify the write
            verify_a = ctx.vault.read_file(doc_a_path)
            checks = {
                "author=Bob on disk": verify_a.frontmatter.get("author") == "Bob",
                "priority=medium on disk": verify_a.frontmatter.get("priority") == "medium",
            }
            all_ok = all(checks.values())
            detail = f"author={verify_a.frontmatter.get('author')!r}, priority={verify_a.frontmatter.get('priority')!r}"
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. {detail}"

            run.step(
                label="modify Plugin A doc frontmatter on disk (author=Bob, priority=medium)",
                passed=all_ok,
                detail=detail,
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            if not all_ok:
                return run
        except Exception as e:
            run.step(
                label="modify Plugin A doc frontmatter on disk (author=Bob, priority=medium)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            return run

        # ── Step 11: Modify Plugin B doc frontmatter on disk (label→changed-value) ──
        t0 = time.monotonic()
        try:
            doc_b_disk = ctx.vault.read_file(doc_b_path)
            fm_b = dict(doc_b_disk.frontmatter)
            fm_b["label"] = "changed-value"
            _write_frontmatter_direct(ctx, doc_b_path, fm_b, doc_b_disk.body)

            # Verify the write
            verify_b = ctx.vault.read_file(doc_b_path)
            checks = {
                "label=changed-value on disk": verify_b.frontmatter.get("label") == "changed-value",
            }
            all_ok = all(checks.values())
            detail = f"label={verify_b.frontmatter.get('label')!r}"
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. {detail}"

            run.step(
                label="modify Plugin B doc frontmatter on disk (label=changed-value)",
                passed=all_ok,
                detail=detail,
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            if not all_ok:
                return run
        except Exception as e:
            run.step(
                label="modify Plugin B doc frontmatter on disk (label=changed-value)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            return run

        # ── Step 12: Scan to detect both modifications ────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — detect frontmatter modifications on both docs",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 13: Wait 32s past the 30s staleness window ──────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past staleness window (30s) — both docs now stale",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 14: RO-28 — Reconcile Plugin A → sync-fields fires ──────────
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_a = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_A_ID,
            plugin_instance=instance_a,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records Plugin A — reconcile after modification (sync-fields should fire)",
            passed=recon_a.ok,
            detail=expectation_detail(recon_a) or recon_a.error or "",
            timing_ms=recon_a.timing_ms,
            tool_result=recon_a,
            server_logs=step_logs,
        )
        if not recon_a.ok:
            return run

        # ── Step 15: RO-28 — Verify field values updated in plugin row ────────
        t0 = time.monotonic()
        record_a_after = _extract_first_record(recon_a.text)

        checks_ro28 = {
            "RO-28: record present": bool(record_a_after),
            "RO-28: author synced to Bob": record_a_after.get("author") == "Bob",
            "RO-28: priority synced to medium": record_a_after.get("priority") == "medium",
        }
        all_ok_ro28 = all(checks_ro28.values())
        detail_parts = []
        if not all_ok_ro28:
            failed = [k for k, v in checks_ro28.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"author={record_a_after.get('author')!r}, priority={record_a_after.get('priority')!r}"
        )
        if not all_ok_ro28:
            detail_parts.append(f"response_preview={recon_a.text[:300]!r}")

        run.step(
            label="RO-28: verify sync-fields updated author=Bob, priority=medium in plugin row",
            passed=all_ok_ro28,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_ro28:
            return run

        # ── Step 16: RO-29 — Reconcile Plugin B → ignore fires (no sync) ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_b = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_B_ID,
            plugin_instance=instance_b,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records Plugin B — reconcile after modification (ignore should fire, no sync)",
            passed=recon_b.ok,
            detail=expectation_detail(recon_b) or recon_b.error or "",
            timing_ms=recon_b.timing_ms,
            tool_result=recon_b,
            server_logs=step_logs,
        )
        if not recon_b.ok:
            return run

        # ── Step 17: RO-29 — Verify label unchanged in Plugin B row ──────────
        t0 = time.monotonic()
        record_b_after = _extract_first_record(recon_b.text)

        checks_ro29 = {
            "RO-29: record present": bool(record_b_after),
            "RO-29: label still original-value (no sync)": record_b_after.get("label") == "original-value",
        }
        all_ok_ro29 = all(checks_ro29.values())
        detail_parts = []
        if not all_ok_ro29:
            failed = [k for k, v in checks_ro29.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(f"label={record_b_after.get('label')!r}")
        if not all_ok_ro29:
            detail_parts.append(f"response_preview={recon_b.text[:300]!r}")

        run.step(
            label="RO-29: verify on_modified:ignore did NOT sync label (still original-value)",
            passed=all_ok_ro29,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_ro29:
            return run

        # ── Sub-scenario A2 continues into RO-59 ─────────────────────────────
        # Remove 'author' key from Plugin A doc frontmatter entirely.
        # Keep 'priority' so we can confirm it is still set correctly.

        t0 = time.monotonic()
        try:
            doc_a_disk2 = ctx.vault.read_file(doc_a_path)
            fm_a2 = {
                k: v for k, v in doc_a_disk2.frontmatter.items()
                if k != "author"
            }
            # Ensure priority is still present
            fm_a2["priority"] = "low"
            _write_frontmatter_direct(ctx, doc_a_path, fm_a2, doc_a_disk2.body)

            # Verify the write
            verify_a2 = ctx.vault.read_file(doc_a_path)
            checks = {
                "author key absent from frontmatter": "author" not in verify_a2.frontmatter,
                "priority=low on disk": verify_a2.frontmatter.get("priority") == "low",
            }
            all_ok = all(checks.values())
            detail = (
                f"author_key_present={'author' in verify_a2.frontmatter}, "
                f"priority={verify_a2.frontmatter.get('priority')!r}"
            )
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. {detail}"

            run.step(
                label="remove 'author' key from Plugin A frontmatter (keep priority=low) — RO-59 setup",
                passed=all_ok,
                detail=detail,
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            if not all_ok:
                return run
        except Exception as e:
            run.step(
                label="remove 'author' key from Plugin A frontmatter — RO-59 setup",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=int((time.monotonic() - t0) * 1000),
            )
            return run

        # ── Step 19: Scan to detect author removal ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan3 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — detect author key removal from Plugin A doc",
            passed=scan3.ok,
            detail=scan3.error or "",
            timing_ms=scan3.timing_ms,
            tool_result=scan3,
            server_logs=step_logs,
        )
        if not scan3.ok:
            return run

        # ── Step 20: Wait 32s for Plugin A staleness window ──────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past staleness window — Plugin A doc stale again (RO-59)",
            passed=True,
            detail=f"Slept {elapsed}ms",
            timing_ms=elapsed,
        )

        # ── Step 21: RO-59 — Reconcile Plugin A → sync-fields fires, author→NULL ──
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_a2 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_A_ID,
            plugin_instance=instance_a,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records Plugin A — sync-fields re-runs; author key absent → NULL (RO-59)",
            passed=recon_a2.ok,
            detail=expectation_detail(recon_a2) or recon_a2.error or "",
            timing_ms=recon_a2.timing_ms,
            tool_result=recon_a2,
            server_logs=step_logs,
        )
        if not recon_a2.ok:
            return run

        # ── Step 22: RO-59 — Verify author is NULL, priority updated ─────────
        t0 = time.monotonic()
        record_a2 = _extract_first_record(recon_a2.text)

        # NULL may be represented as None (JSON null), "" (empty string), or absent key.
        # Check all three representations.
        author_val = record_a2.get("author", "__NOT_PRESENT__")
        author_is_null = (
            author_val is None
            or author_val == ""
            or author_val == "__NOT_PRESENT__"
        )

        checks_ro59 = {
            "RO-59: record present": bool(record_a2),
            "RO-59: author is NULL/empty/absent (field_map sets NULL for absent frontmatter)": author_is_null,
            "RO-59: priority synced to low (field present)": record_a2.get("priority") == "low",
        }
        all_ok_ro59 = all(checks_ro59.values())
        detail_parts = []
        if not all_ok_ro59:
            failed = [k for k, v in checks_ro59.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"author={author_val!r} (null_check={author_is_null}), "
            f"priority={record_a2.get('priority')!r}"
        )
        if not all_ok_ro59:
            detail_parts.append(f"response_preview={recon_a2.text[:300]!r}")

        run.step(
            label="RO-59: author is NULL (absent from frontmatter), priority=low synced",
            passed=all_ok_ro59,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )
        if not all_ok_ro59:
            return run

        # ── Sub-scenario B2: RO-30 — wait another 32s, reconcile again ───────
        # The first on_modified:ignore reconcile should have updated last_seen_updated_at.
        # So the next reconcile should classify doc B as 'unchanged', not 'modified'.

        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s (second staleness window for Plugin B) — RO-30 setup",
            passed=True,
            detail=f"Slept {elapsed}ms; if last_seen_updated_at was updated, doc B should be 'unchanged'",
            timing_ms=elapsed,
        )

        # ── Step 24: RO-30 — Second reconcile for Plugin B ───────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_b2 = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_B_ID,
            plugin_instance=instance_b,
            table="items",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records Plugin B — second reconcile after ignore (RO-30)",
            passed=recon_b2.ok,
            detail=expectation_detail(recon_b2) or recon_b2.error or "",
            timing_ms=recon_b2.timing_ms,
            tool_result=recon_b2,
            server_logs=step_logs,
        )
        if not recon_b2.ok:
            return run

        # ── Step 25: RO-30 — Verify second reconcile shows 'unchanged' ───────
        # If last_seen_updated_at was NOT updated during the first ignore pass,
        # the doc would be re-classified as 'modified' and the summary would show a
        # "Modified" or "Synced" count. We verify the summary does NOT indicate
        # modification activity on the second pass.
        t0 = time.monotonic()
        recon_summary_b2 = _extract_recon_summary(recon_b2.text)

        # The key invariant: if last_seen_updated_at was updated, there should be
        # no "Modified" classification on the second pass.
        # A clean second pass has summary with 0 modifications or shows 'Unchanged'.
        # We also verify the label is STILL original-value (doubly ensuring no sync).
        record_b2 = _extract_first_record(recon_b2.text)

        # "Modified" in the summary would indicate the doc was re-evaluated as modified.
        # An empty or "unchanged" summary is the pass condition for RO-30.
        # The summary may also say "1 unchanged" or have no Modified count.
        summary_has_modified = bool(re.search(r"\bModified\b", recon_summary_b2, re.IGNORECASE))
        summary_has_synced = bool(re.search(r"\bSynced\b", recon_summary_b2, re.IGNORECASE))

        # Also accept: summary is empty (no stale docs found → all docs are current)
        # or summary explicitly shows 0 modified / unchanged.
        label_still_original = record_b2.get("label") == "original-value"

        checks_ro30 = {
            "RO-30: no 'Modified' in reconciliation summary (doc treated as unchanged)": not summary_has_modified,
            "RO-30: no 'Synced' in reconciliation summary (on_modified:ignore not re-triggered)": not summary_has_synced,
            "RO-30: label still original-value (no sync happened on second pass)": label_still_original,
        }
        all_ok_ro30 = all(checks_ro30.values())
        detail_parts = []
        if not all_ok_ro30:
            failed = [k for k, v in checks_ro30.items() if not v]
            detail_parts.append(f"Failed: {', '.join(failed)}")
        detail_parts.append(
            f"summary_has_modified={summary_has_modified}, "
            f"summary_has_synced={summary_has_synced}, "
            f"label={record_b2.get('label')!r}"
        )
        detail_parts.append(f"recon_summary={recon_summary_b2!r}")

        run.step(
            label="RO-30: second reconcile shows no modification activity (last_seen_updated_at was set)",
            passed=all_ok_ro30,
            detail=" | ".join(detail_parts),
            timing_ms=int((time.monotonic() - t0) * 1000),
        )

        # ── Cleanup: unregister both plugins ─────────────────────────────────
        for plugin_id, instance_name, registered in [
            (PLUGIN_A_ID, instance_a, plugin_a_registered),
            (PLUGIN_B_ID, instance_b, plugin_b_registered),
        ]:
            if registered:
                try:
                    teardown = ctx.client.call_tool(
                        "unregister_plugin",
                        plugin_id=plugin_id,
                        plugin_instance=instance_name,
                        confirm_destroy=True,
                    )
                    if not teardown.ok:
                        ctx.cleanup_errors.append(
                            f"unregister_plugin failed for {plugin_id}/{instance_name}: "
                            f"{teardown.error or teardown.text}"
                        )
                except Exception as e:
                    ctx.cleanup_errors.append(
                        f"unregister_plugin exception for {plugin_id}/{instance_name}: {e}"
                    )

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=(
                    f"Plugins retained: {PLUGIN_A_ID}/{instance_a}, "
                    f"{PLUGIN_B_ID}/{instance_b}"
                ),
            )

        # ── Attach full server logs ────────────────────────────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # After `with` block: cleanup has run, server has stopped
    run.record_cleanup(ctx.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Test: reconciliation modification and field sync — "
            "on_modified:sync-fields, on_modified:ignore, NULL field_map, last_seen_updated_at."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
    parser.add_argument("--managed", action="store_true",
                         help="Start a dedicated FQC server for this test run.")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"),
                         default=None,
                         help="Port range for managed server (default: 9100 9199).")
    parser.add_argument("--json", action="store_true", dest="output_json",
                         help="Emit structured JSON to stdout.")
    parser.add_argument("--keep", action="store_true",
                         help="Retain test files for debugging (skip cleanup).")

    args = parser.parse_args()
    run = run_test(args)

    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)

    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()
