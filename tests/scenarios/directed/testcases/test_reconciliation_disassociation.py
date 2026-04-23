#!/usr/bin/env python3
"""
Test: Reconciliation disassociation — removing fqc_owner/fqc_type triggers plugin row archival;
      moving a file with frontmatter intact reports 'moved', not 'disassociated';
      disassociated document remains active in fqc_documents.

Scenario:
    1. Register a plugin with on_added: auto-track, on_moved: keep-tracking (register_plugin)
    2. Create 2 docs in the watched folder via ctx.create_file (no MCP ownership yet)
    3. Scan vault to index both docs into fqc_documents (force_file_scan)
    4. Trigger first reconciliation — auto-tracks both docs (search_records). Seeds staleness cache.
    5. Wait 32s to expire the staleness window.
    6. Read both docs from disk to capture fqc_owner, fqc_type, fqc_id.
    7a. RO-16 setup: Remove fqc_owner and fqc_type from doc_disassoc's frontmatter.
    7b. RO-17 setup: Physically move doc_moved to new path with all frontmatter intact.
    8. Scan vault (detects: fqc_owner removed from doc_disassoc; old moved path missing, new path present).
    9. Trigger second full reconciliation (search_records).
    10a. RO-16: Verify 'disassociated' — plugin row archived; doc_disassoc record not in search results.
    10b. RO-17: Verify 'moved' — doc_moved record still in search results (keep-tracking, not archived).
    10c. RO-18: Verify doc_disassoc still active in fqc_documents — get_document returns it as active.
    Cleanup is automatic.

Coverage points: RO-16, RO-17, RO-18

Modes:
    Default     Connects to an already-running FlashQuery instance
    --managed   Starts a dedicated FlashQuery subprocess for this test

Usage:
    python test_reconciliation_disassociation.py                            # existing server
    python test_reconciliation_disassociation.py --managed                  # managed server
    python test_reconciliation_disassociation.py --managed --json           # structured output
    python test_reconciliation_disassociation.py --managed --json --keep    # retain files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations

COVERAGE = ["RO-16", "RO-17", "RO-18"]

import argparse
import re
import shutil
import sys
import time
from pathlib import Path

# Three levels up: testcases/ → directed/ → scenarios/ → framework/
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail
from frontmatter_fields import FM


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_reconciliation_disassociation"
PLUGIN_ID = "recon_dis"
DOC_TYPE_ID = "dis_note"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _build_schema_yaml(folder: str) -> str:
    """
    Plugin schema with:
    - on_added: auto-track  → new docs get a plugin row inserted automatically
    - on_moved: keep-tracking → moved docs have their path updated (row stays active)
    This lets RO-17 verify that 'moved' does NOT archive the plugin row.
    """
    return (
        "plugin:\n"
        f"  id: {PLUGIN_ID}\n"
        "  name: Reconciliation Disassociation Test Plugin\n"
        "  version: 1.0.0\n"
        "  description: Scenario-test fixture for disassociation reconciliation\n"
        "\n"
        "tables:\n"
        "  - name: notes\n"
        "    description: Tracked notes\n"
        "    columns:\n"
        "      - name: label\n"
        "        type: text\n"
        "\n"
        "documents:\n"
        "  types:\n"
        f"    - id: {DOC_TYPE_ID}\n"
        f"      folder: {folder}\n"
        "      on_added: auto-track\n"
        "      track_as: notes\n"
        "      on_modified: ignore\n"
        "      on_moved: keep-tracking\n"
    )


def _extract_recon_summary(text: str) -> str:
    """Extract the reconciliation summary from a tool response."""
    m = re.search(r"Reconciliation:.*", text, re.DOTALL)
    return m.group(0).strip() if m else ""


def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FlashQuery's key-value response format."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    instance_name = f"test_{run.run_id[:8]}"
    folder = f"_test_recon_dis/{run.run_id[:8]}"
    schema_yaml = _build_schema_yaml(folder)

    doc_disassoc_path = f"{folder}/doc_disassoc_{run.run_id[:8]}.md"
    doc_moved_path = f"{folder}/doc_moved_{run.run_id[:8]}.md"
    doc_moved_new_path = f"{folder}/doc_moved_relocated_{run.run_id[:8]}.md"

    port_range = tuple(args.port_range) if args.port_range else None
    plugin_registered = False

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always force a dedicated managed server — clean DB state required.
        managed=True,
        port_range=port_range,
    ) as ctx:

        # ── Step 1: Register plugin ───────────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        register_result = ctx.client.call_tool(
            "register_plugin",
            schema_yaml=schema_yaml,
            plugin_instance=instance_name,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        register_result.expect_contains("registered successfully")
        register_result.expect_contains(instance_name)

        run.step(
            label="register_plugin (auto-track schema with on_moved: keep-tracking)",
            passed=(register_result.ok and register_result.status == "pass"),
            detail=expectation_detail(register_result) or register_result.error or "",
            timing_ms=register_result.timing_ms,
            tool_result=register_result,
            server_logs=step_logs,
        )
        if not register_result.ok:
            return run
        plugin_registered = True
        ctx.cleanup.track_plugin_registration(PLUGIN_ID, instance_name)

        # ── Step 2: Create 2 docs in watched folder ───────────────────────────
        ctx.create_file(
            doc_disassoc_path,
            title=f"Disassoc Doc {run.run_id[:8]}",
            body="## Disassociation Test\n\nThis doc will have fqc_owner removed.",
            tags=["fqc-test", "recon-dis"],
        )
        ctx.create_file(
            doc_moved_path,
            title=f"Moved Doc {run.run_id[:8]}",
            body="## Move Test\n\nThis doc will be physically moved with frontmatter intact.",
            tags=["fqc-test", "recon-dis"],
        )
        ctx.cleanup.track_dir(folder)
        ctx.cleanup.track_dir("_test_recon_dis")

        run.step(
            label="create 2 docs in watched folder (no fqc_owner — will be auto-tracked)",
            passed=True,
            detail=f"Created: {doc_disassoc_path}, {doc_moved_path}",
        )

        # ── Step 3: force_file_scan — index both docs into fqc_documents ─────
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

        # ── Step 4: First reconciliation — auto-tracks both docs ──────────────
        # Seeds the staleness cache. Both docs get fqc_owner/fqc_type written to disk.
        log_mark = ctx.server.log_position if ctx.server else 0
        prime_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        prime_result.expect_contains("Auto-tracked")

        run.step(
            label="search_records (prime) — auto-tracks both docs; seeds staleness cache",
            passed=(prime_result.ok and prime_result.status == "pass"),
            detail=expectation_detail(prime_result) or prime_result.error or "",
            timing_ms=prime_result.timing_ms,
            tool_result=prime_result,
            server_logs=step_logs,
        )
        if not prime_result.ok:
            return run

        # ── Step 5: Wait 32s past the 30s staleness window ───────────────────
        t0 = time.monotonic()
        time.sleep(32)
        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="wait 32s past reconciliation staleness window (30s)",
            passed=True,
            detail=f"Slept {elapsed}ms to ensure staleness cache expired",
            timing_ms=elapsed,
        )

        # ── Step 6: Read both docs from disk — capture fqc_owner, fqc_type, fqc_id ──
        t0 = time.monotonic()
        try:
            doc_dis = ctx.vault.read_file(doc_disassoc_path)
            fm_dis = doc_dis.frontmatter
            fqc_id_disassoc = fm_dis.get(FM.ID)

            doc_mov = ctx.vault.read_file(doc_moved_path)
            fm_mov = doc_mov.frontmatter
            fqc_id_moved = fm_mov.get(FM.ID)
            fqc_owner_moved = fm_mov.get(FM.OWNER)
            fqc_type_moved = fm_mov.get(FM.TYPE)

            checks = {
                "doc_disassoc has fqc_owner in frontmatter": bool(fm_dis.get(FM.OWNER)),
                "doc_disassoc has fqc_type in frontmatter": bool(fm_dis.get(FM.TYPE)),
                "doc_disassoc has fqc_id": bool(fqc_id_disassoc),
                "doc_moved has fqc_owner in frontmatter": bool(fqc_owner_moved),
                "doc_moved has fqc_type in frontmatter": bool(fqc_type_moved),
                "doc_moved has fqc_id": bool(fqc_id_moved),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = (
                    f"Failed: {', '.join(failed)}. "
                    f"dis_fm={dict(fm_dis)!r}, mov_fm={dict(fm_mov)!r}"
                )

            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="read both docs from disk — verify auto-track wrote fqc_owner/fqc_type",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run

        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="read both docs from disk — verify auto-track wrote fqc_owner/fqc_type",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 7a: RO-16 setup — remove fqc_owner and fqc_type from doc_disassoc ──
        # NOTE: write_frontmatter() merges updates into existing frontmatter, so
        # it cannot be used to delete keys. We must write the file directly.
        # We read the full frontmatter, exclude fqc_owner/fqc_type, then write
        # the file from scratch to ensure those keys are absent.
        t0 = time.monotonic()
        try:
            import yaml
            dis_doc = ctx.vault.read_file(doc_disassoc_path)
            # Build frontmatter without fqc_owner and fqc_type
            fm_keys_to_keep = {
                k: v for k, v in dis_doc.frontmatter.items()
                if k not in (FM.OWNER, FM.TYPE)
            }
            # Update the 'updated' timestamp to ensure the scanner detects a change
            from datetime import datetime, timezone
            fm_keys_to_keep[FM.UPDATED] = (
                datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.")
                + f"{datetime.now(timezone.utc).microsecond // 1000:03d}Z"
            )
            fm_yaml = yaml.dump(fm_keys_to_keep, default_flow_style=False, sort_keys=False, allow_unicode=True)
            new_content = f"---\n{fm_yaml}---\n\n{dis_doc.body}"
            abs_dis = ctx.vault.vault_root / doc_disassoc_path
            tmp_dis = abs_dis.with_name(abs_dis.name + ".fqc-tmp")
            tmp_dis.write_text(new_content, encoding="utf-8")
            tmp_dis.rename(abs_dis)

            # Verify the write removed fqc_owner
            verify_doc = ctx.vault.read_file(doc_disassoc_path)
            owner_absent = FM.OWNER not in verify_doc.frontmatter
            type_absent = FM.TYPE not in verify_doc.frontmatter

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "fqc_owner absent from frontmatter after write": owner_absent,
                "fqc_type absent from frontmatter after write": type_absent,
            }
            all_ok = all(checks.values())
            detail = "fqc_owner and fqc_type removed from frontmatter; scanner will clear ownership_plugin_id"
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}. fm={dict(verify_doc.frontmatter)!r}"
            run.step(
                label="remove fqc_owner/fqc_type from doc_disassoc frontmatter (RO-16 setup)",
                passed=all_ok,
                detail=detail,
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="remove fqc_owner/fqc_type from doc_disassoc frontmatter (RO-16 setup)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 7b: RO-17 setup — physically move doc_moved with frontmatter intact ──
        t0 = time.monotonic()
        try:
            old_abs = ctx.vault.vault_root / doc_moved_path
            new_abs = ctx.vault.vault_root / doc_moved_new_path
            new_abs.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(str(old_abs), str(new_abs))
            old_abs.unlink()
            # Track the new file path for cleanup
            ctx.cleanup.track_file(doc_moved_new_path)

            elapsed = int((time.monotonic() - t0) * 1000)
            checks = {
                "old path gone": not old_abs.is_file(),
                "new path exists": new_abs.is_file(),
            }
            all_ok = all(checks.values())
            detail = ""
            if not all_ok:
                failed = [k for k, v in checks.items() if not v]
                detail = f"Failed: {', '.join(failed)}"
            run.step(
                label="move doc_moved to new path with frontmatter intact (RO-17 setup)",
                passed=all_ok,
                detail=detail or f"Moved: {doc_moved_path} → {doc_moved_new_path}",
                timing_ms=elapsed,
            )
            if not all_ok:
                return run
        except Exception as e:
            elapsed = int((time.monotonic() - t0) * 1000)
            run.step(
                label="move doc_moved to new path with frontmatter intact (RO-17 setup)",
                passed=False,
                detail=f"Exception: {e}",
                timing_ms=elapsed,
            )
            return run

        # ── Step 8: Scan vault — detect both state changes ────────────────────
        # Scanner picks up:
        # - doc_disassoc: fqc_owner removed → ownership_plugin_id cleared/changed in DB
        # - old doc_moved path: missing → scanner marks it
        # - new doc_moved path: new file with same fqc_id → reconciler identifies as moved
        log_mark = ctx.server.log_position if ctx.server else 0
        scan2 = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="force_file_scan — detect fqc_owner removal and file move",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )
        if not scan2.ok:
            return run

        # ── Step 9: Second full reconciliation — classifies disassociated + moved ──
        log_mark = ctx.server.log_position if ctx.server else 0
        recon_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        run.step(
            label="search_records — triggers second full reconciliation pass",
            passed=recon_result.ok,
            detail=expectation_detail(recon_result) or recon_result.error or "",
            timing_ms=recon_result.timing_ms,
            tool_result=recon_result,
            server_logs=step_logs,
        )
        if not recon_result.ok:
            return run

        recon_summary = _extract_recon_summary(recon_result.text)

        # ── Step 10a: RO-16 — verify disassociated plugin row is archived ─────
        # The Archived count should be >= 1 (doc_disassoc's plugin row archived).
        # After archival, search_records should NOT return doc_disassoc's record.
        t0 = time.monotonic()
        m_archived = re.search(r"Archived (\d+) record", recon_summary)
        archived_count = int(m_archived.group(1)) if m_archived else 0

        checks_16: dict[str, bool] = {
            "RO-16: reconciliation ran (non-empty summary)": len(recon_summary) > 0,
            "RO-16: at least 1 plugin row archived (disassociated)": archived_count >= 1,
        }
        all_ok_16 = all(checks_16.values())
        detail_16_parts = []
        if not all_ok_16:
            failed = [k for k, v in checks_16.items() if not v]
            detail_16_parts.append(f"Failed: {', '.join(failed)}")
        detail_16_parts.append(
            f"archived_count={archived_count} | recon_summary={recon_summary!r}"
        )

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-16: disassociated doc triggers plugin row archival (archived_count >= 1)",
            passed=all_ok_16,
            detail=" | ".join(detail_16_parts),
            timing_ms=elapsed,
        )
        if not all_ok_16:
            return run

        # ── Step 10a (continued): verify disassociated record absent from search ──
        # After archival, search_records should not return doc_disassoc's row.
        log_mark = ctx.server.log_position if ctx.server else 0
        verify_dis_result = ctx.client.call_tool(
            "search_records",
            plugin_id=PLUGIN_ID,
            plugin_instance=instance_name,
            table="notes",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        t0 = time.monotonic()
        # Search results should not contain doc_disassoc's fqc_id (row is archived)
        # and should still contain doc_moved's fqc_id (row is active with updated path).
        verify_text = verify_dis_result.text

        dis_in_results = fqc_id_disassoc and fqc_id_disassoc in verify_text
        moved_in_results = fqc_id_moved and fqc_id_moved in verify_text

        checks_verify: dict[str, bool] = {
            "RO-16: doc_disassoc fqc_id absent from search results (row archived)": not dis_in_results,
            "RO-17: doc_moved fqc_id present in search results (row still active)": bool(moved_in_results),
        }
        all_ok_verify = all(checks_verify.values())
        detail_verify_parts = []
        if not all_ok_verify:
            failed = [k for k, v in checks_verify.items() if not v]
            detail_verify_parts.append(f"Failed: {', '.join(failed)}")
        detail_verify_parts.append(
            f"dis_in_results={dis_in_results} | moved_in_results={moved_in_results} | "
            f"fqc_id_disassoc={fqc_id_disassoc!r} | fqc_id_moved={fqc_id_moved!r}"
        )
        if not all_ok_verify:
            detail_verify_parts.append(f"response_preview={verify_text[:400]!r}")

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-16 + RO-17: verify search_records — disassoc absent, moved present",
            passed=all_ok_verify,
            detail=" | ".join(detail_verify_parts),
            timing_ms=elapsed,
            tool_result=verify_dis_result,
            server_logs=step_logs,
        )
        if not all_ok_verify:
            return run

        # ── Step 10b: RO-17 — verify archived count is exactly 1 (only doc_disassoc) ──
        # If doc_moved was incorrectly classified as disassociated, archived_count would be >= 2.
        t0 = time.monotonic()
        checks_17: dict[str, bool] = {
            "RO-17: archived count == 1 (only doc_disassoc, not doc_moved)": archived_count == 1,
        }
        all_ok_17 = all(checks_17.values())
        detail_17_parts = []
        if not all_ok_17:
            detail_17_parts.append(
                f"Expected archived_count=1 (only doc_disassoc should be archived), got {archived_count}. "
                f"If archived_count=2, doc_moved was incorrectly classified as disassociated "
                f"instead of 'moved' — on_moved: keep-tracking should prevent archival."
            )
        detail_17_parts.append(f"archived_count={archived_count}")

        elapsed = int((time.monotonic() - t0) * 1000)
        run.step(
            label="RO-17: moved doc NOT archived — archived_count == 1 (only disassoc)",
            passed=all_ok_17,
            detail=" | ".join(detail_17_parts),
            timing_ms=elapsed,
        )
        if not all_ok_17:
            return run

        # ── Step 10c: RO-18 — verify doc_disassoc remains active in fqc_documents ──
        # The plugin row was archived, but the fqc_documents row should still be active.
        # Verification strategy (public surface only, no direct DB queries):
        #   (a) get_document returns body content (not "not found") — doc still readable
        #   (b) search_documents by fqc_id finds the doc — active docs appear in search,
        #       archived docs do not. If fqc_documents.status were 'archived', search would
        #       return 0 results (archived docs are excluded from search indexes).
        log_mark = ctx.server.log_position if ctx.server else 0
        get_doc_result = ctx.client.call_tool(
            "get_document",
            identifier=doc_disassoc_path,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        # (a) get_document should return body content, not an error
        # The response is the raw markdown body (no "Status:" header in get_document output)
        doc_found = (
            get_doc_result.ok
            and "not found" not in get_doc_result.text.lower()
            and "error" not in get_doc_result.text.lower()[:20]  # check prefix only
            and len(get_doc_result.text.strip()) > 0
        )

        t0 = time.monotonic()
        elapsed_get = get_doc_result.timing_ms or 0

        # (b) search_documents — active docs appear in search, archived ones do not
        # Use the exact doc title substring + unique run_id to avoid false positives.
        # The doc title is "Disassoc Doc {run.run_id[:8]}" — search by title substring.
        disassoc_title = f"Disassoc Doc {run.run_id[:8]}"
        log_mark2 = ctx.server.log_position if ctx.server else 0
        search_doc_result = ctx.client.call_tool(
            "search_documents",
            query=disassoc_title,
        )
        step_logs2 = ctx.server.logs_since(log_mark2) if ctx.server else None

        # If fqc_documents.status were 'archived', the doc would not appear in search results.
        # We check that either:
        #   - The run_id[:8] appears in search results (title match), OR
        #   - search_documents returns at least 1 result that mentions our doc
        doc_in_search = (
            search_doc_result.ok
            and run.run_id[:8] in search_doc_result.text
        )

        elapsed = int((time.monotonic() - t0) * 1000)

        checks_18: dict[str, bool] = {
            "RO-18: get_document returns content (doc exists, not archived in fqc_documents)": doc_found,
            "RO-18: search_documents finds disassoc doc (fqc_documents row still active)": doc_in_search,
        }
        all_ok_18 = all(checks_18.values())
        detail_18_parts = []
        if not all_ok_18:
            failed = [k for k, v in checks_18.items() if not v]
            detail_18_parts.append(f"Failed: {', '.join(failed)}")
        detail_18_parts.append(
            f"doc_found={doc_found} | doc_in_search={doc_in_search} | "
            f"get_ok={get_doc_result.ok} | search_ok={search_doc_result.ok}"
        )
        if not all_ok_18:
            detail_18_parts.append(
                f"get_preview={get_doc_result.text[:200]!r} | "
                f"search_preview={search_doc_result.text[:200]!r}"
            )

        run.step(
            label="RO-18: get_document + search_documents confirm disassoc doc still active in fqc_documents",
            passed=all_ok_18,
            detail=" | ".join(detail_18_parts),
            timing_ms=elapsed,
            tool_result=get_doc_result,
            server_logs=step_logs,
        )

        # ── Cleanup: unregister plugin ────────────────────────────────────────
        if plugin_registered:
            try:
                teardown = ctx.client.call_tool(
                    "unregister_plugin",
                    plugin_id=PLUGIN_ID,
                    plugin_instance=instance_name,
                    confirm_destroy=True,
                )
                if not teardown.ok:
                    ctx.cleanup_errors.append(
                        f"unregister_plugin failed: {teardown.error or teardown.text}"
                    )
            except Exception as e:
                ctx.cleanup_errors.append(f"unregister_plugin exception: {e}")

        # ── Optionally retain files for debugging ─────────────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            ctx.cleanup._plugin_registrations.clear()
            run.step(
                label="Cleanup skipped (--keep)",
                passed=True,
                detail=f"Plugin instance retained: {PLUGIN_ID}/{instance_name}",
            )

        # ── Attach full server logs to the run ────────────────────────────────
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
        description="Test: reconciliation disassociation — plugin row archival, moved vs disassociated, fqc_documents status.",
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
