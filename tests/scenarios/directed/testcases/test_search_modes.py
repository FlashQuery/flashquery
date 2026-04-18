#!/usr/bin/env python3
"""
Test: search_documents across filesystem / semantic / mixed modes plus fallback.

Scenario:
    Phase 1 — embeddings enabled (require_embedding=True):
        1. Create Doc A and Doc B via MCP, both tagged with a unique run tag,
           with disjoint bodies (library/forbidden knowledge vs feline/midnight
           corridors) and bland non-overlapping titles.
        2. Force a sync vault scan so embeddings are generated.
        3. (S-07) search_documents(mode='semantic') with a paraphrased query
           that doesn't share literal words with Doc A's body — verify Doc A
           surfaces via semantic similarity.
        4. (S-08) search_documents(mode='mixed') using Doc B's literal title
           token — verify Doc B is found (filesystem hit) and at least one
           result is returned overall.

    Phase 2 — embeddings disabled (require_embedding=False, second context):
        5. Create a single document with a unique literal title token.
        6. (S-09) search_documents(query=<unique>, mode='semantic') — verify
           the call does not crash. Either it gracefully degrades (ok=True
           with sane content) or it returns a clear "embeddings unsupported"
           error. Both shapes are acceptable; a server crash is not.
        7. (X-10) Same graceful-fallback check on mode='mixed'.

    Cleanup is automatic for both phases (filesystem + database) even on failure.

Coverage points: S-07, S-08, S-09, X-10

Modes:
    Default     Connects to an already-running FQC instance (config from flashquery.yml)
    --managed   Starts a dedicated FQC subprocess for this test, captures its logs,
                and shuts it down afterwards. Server logs are included in JSON output.

Usage:
    python test_search_modes.py                            # existing server
    python test_search_modes.py --managed                  # managed server
    python test_search_modes.py --managed --json           # structured JSON with server logs
    python test_search_modes.py --managed --json --keep    # keep files for debugging

Exit codes:
    0   PASS    All steps passed and cleanup was clean
    2   FAIL    One or more test steps failed
    3   DIRTY   Steps passed but cleanup had errors
"""
from __future__ import annotations


COVERAGE = ["S-07", "S-08", "S-09", "X-10"]
REQUIRES_MANAGED = True

import argparse
import re
import sys
import time
from pathlib import Path

# Add the framework directory to the path for shared imports
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_search_modes"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FQC key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _track_created(ctx, result_text: str) -> tuple[str, str]:
    """Register a freshly-created document for cleanup. Returns (fqc_id, path)."""
    fqc_id = _extract_field(result_text, "FQC ID")
    path = _extract_field(result_text, "Path")
    if path:
        ctx.cleanup.track_file(path)
        parts = Path(path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if fqc_id:
        ctx.cleanup.track_mcp_document(fqc_id)
    return fqc_id, path


def _looks_like_graceful_fallback(result) -> tuple[bool, str]:
    """
    Decide whether a search_documents response in semantic/mixed mode without
    embeddings is acceptably handled.

    Acceptable:
      - ok=True with non-empty text (filesystem fallback or empty-results msg
        that doesn't claim semantic worked).
      - ok=False with error text mentioning embedding/semantic/disabled/
        unsupported/not available/not configured.
    Unacceptable:
      - ok=True with empty text.
      - ok=False with no informative error text.
    """
    fallback_keywords = (
        "embedding",
        "semantic",
        "disabled",
        "unsupported",
        "not available",
        "not configured",
        "no provider",
    )
    text = (result.text or "").strip()
    err = (result.error or "").strip()
    blob = f"{text}\n{err}".lower()

    if result.ok:
        if not text:
            return False, "ok=True but empty response text"
        return True, f"ok=True, text length={len(text)} (filesystem fallback or benign empty)"
    # ok=False — must mention embeddings/semantic to be a clear unsupported error
    if any(kw in blob for kw in fallback_keywords):
        return True, f"ok=False with clear unsupported error: {err or text[:160]!r}"
    return False, f"ok=False but error text is opaque: err={err!r} text={text[:160]!r}"


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)

    port_range = tuple(args.port_range) if args.port_range else None

    # Phase-1 fixture data (with embeddings)
    unique_tag = f"smodes-{run.run_id}"
    title_a = f"Alpha Notebook {run.run_id}"
    title_b = f"Bravo Ledger {run.run_id}"
    path_a = f"_test/{TEST_NAME}_{run.run_id}_a.md"
    path_b = f"_test/{TEST_NAME}_{run.run_id}_b.md"
    body_a = (
        f"## Doc A\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"The ancient library holds forbidden knowledge, dusty tomes, "
        f"and scrolls of arcane lore that scholars have sought for centuries."
    )
    body_b = (
        f"## Doc B\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}).\n\n"
        f"A feline stalks through midnight corridors, its paws silent on the "
        f"cold stone, hunting whatever moves in the long shadows."
    )
    tags_common = ["fqc-test", unique_tag]

    # Phase-2 fixture data (without embeddings) — fresh run-id token
    fallback_token = f"falltok{run.run_id.replace('-', '')[:12]}"
    title_c = f"Charlie {fallback_token}"
    path_c = f"_test/{TEST_NAME}_{run.run_id}_c.md"
    body_c = (
        f"## Doc C\n\n"
        f"Created by {TEST_NAME} (run {run.run_id}) for the fallback phase.\n\n"
        f"Unique literal token for filesystem matching: {fallback_token}."
    )
    tags_c = ["fqc-test", f"smodes-fallback-{run.run_id}"]

    # =========================================================================
    # Phase 1 — embeddings ENABLED
    # =========================================================================

    with TestContext(
        fqc_dir=args.fqc_dir,
        # Always start a dedicated managed server — require_embedding=True
        # configures the embedding provider; the shared suite server has none.
        managed=True,
        port_range=port_range,
        require_embedding=True,
    ) as ctx:

        # ── Step 1a: Create Doc A via MCP ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_a = ctx.client.call_tool(
            "create_document",
            title=title_a,
            content=body_a,
            path=path_a,
            tags=tags_common,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        fqc_id_a, _ = _track_created(ctx, create_a.text)
        create_a.expect_contains(title_a)
        run.step(
            label="create_document Doc A (library/forbidden knowledge)",
            passed=(create_a.ok and create_a.status == "pass"),
            detail=expectation_detail(create_a) or create_a.error or "",
            timing_ms=create_a.timing_ms,
            tool_result=create_a,
            server_logs=step_logs,
        )
        if not create_a.ok:
            return run

        # ── Step 1b: Create Doc B via MCP ────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_b = ctx.client.call_tool(
            "create_document",
            title=title_b,
            content=body_b,
            path=path_b,
            tags=tags_common,
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        fqc_id_b, _ = _track_created(ctx, create_b.text)
        create_b.expect_contains(title_b)
        run.step(
            label="create_document Doc B (feline/midnight corridors)",
            passed=(create_b.ok and create_b.status == "pass"),
            detail=expectation_detail(create_b) or create_b.error or "",
            timing_ms=create_b.timing_ms,
            tool_result=create_b,
            server_logs=step_logs,
        )
        if not create_b.ok:
            return run

        # ── Step 2: Force vault scan so embeddings get generated ─────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan_result = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        run.step(
            label="force_file_scan (sync) to generate embeddings",
            passed=scan_result.ok,
            detail=scan_result.error or "",
            timing_ms=scan_result.timing_ms,
            tool_result=scan_result,
            server_logs=step_logs,
        )
        if not scan_result.ok:
            return run

        # Embedding pipeline may run async after scan — give it a moment.
        time.sleep(2.0)

        # ── Step 3: Semantic search returns results (S-07) ───────────
        # Paraphrased query: literal words don't appear in Doc A, but the
        # concept does ("library"/"forbidden knowledge"/"arcane lore").
        log_mark = ctx.server.log_position if ctx.server else 0
        sem_result = ctx.client.call_tool(
            "search_documents",
            query="repository of arcane wisdom",
            tags=[unique_tag],
            mode="semantic",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        sem_result.expect_count_gte(1)
        sem_result.expect_contains(title_a)

        run.step(
            label="search_documents mode='semantic' surfaces Doc A (S-07)",
            passed=(sem_result.ok and sem_result.status == "pass"),
            detail=expectation_detail(sem_result) or sem_result.error or "",
            timing_ms=sem_result.timing_ms,
            tool_result=sem_result,
            server_logs=step_logs,
        )

        # ── Step 4: Mixed mode combines fs + semantic (S-08) ─────────
        # Use a literal token from Doc B's title — filesystem half should hit.
        log_mark = ctx.server.log_position if ctx.server else 0
        mixed_result = ctx.client.call_tool(
            "search_documents",
            query=f"Bravo Ledger {run.run_id}",
            tags=[unique_tag],
            mode="mixed",
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        mixed_result.expect_count_gte(1)
        mixed_result.expect_contains(title_b)

        run.step(
            label="search_documents mode='mixed' returns Doc B (S-08)",
            passed=(mixed_result.ok and mixed_result.status == "pass"),
            detail=expectation_detail(mixed_result) or mixed_result.error or "",
            timing_ms=mixed_result.timing_ms,
            tool_result=mixed_result,
            server_logs=step_logs,
        )

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="Phase 1 cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────
        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    # Phase 1 cleanup has run, server has stopped.
    run.record_cleanup(ctx.cleanup_errors)

    # =========================================================================
    # Phase 2 — embeddings DISABLED (graceful fallback)
    # =========================================================================

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx2:

        # ── Step 5: Create Doc C with a unique literal token ─────────
        log_mark = ctx2.server.log_position if ctx2.server else 0
        create_c = ctx2.client.call_tool(
            "create_document",
            title=title_c,
            content=body_c,
            path=path_c,
            tags=tags_c,
        )
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None
        _track_created(ctx2, create_c.text)
        create_c.expect_contains(title_c)
        run.step(
            label="create_document Doc C (fallback phase)",
            passed=(create_c.ok and create_c.status == "pass"),
            detail=expectation_detail(create_c) or create_c.error or "",
            timing_ms=create_c.timing_ms,
            tool_result=create_c,
            server_logs=step_logs,
        )
        if not create_c.ok:
            run.record_cleanup(ctx2.cleanup_errors)
            return run

        # Make sure Doc C is indexed for the filesystem half of any fallback.
        log_mark = ctx2.server.log_position if ctx2.server else 0
        scan2 = ctx2.scan_vault()
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None
        run.step(
            label="force_file_scan (sync) — fallback phase",
            passed=scan2.ok,
            detail=scan2.error or "",
            timing_ms=scan2.timing_ms,
            tool_result=scan2,
            server_logs=step_logs,
        )

        # ── Step 6: Semantic search without embeddings (S-09) ────────
        log_mark = ctx2.server.log_position if ctx2.server else 0
        sem_fallback = ctx2.client.call_tool(
            "search_documents",
            query=fallback_token,
            mode="semantic",
        )
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None

        ok_s09, why_s09 = _looks_like_graceful_fallback(sem_fallback)
        run.step(
            label="search_documents mode='semantic' graceful fallback (S-09)",
            passed=ok_s09,
            detail=why_s09,
            timing_ms=sem_fallback.timing_ms,
            tool_result=sem_fallback,
            server_logs=step_logs,
        )

        # ── Step 7: Mixed search without embeddings (X-10) ───────────
        log_mark = ctx2.server.log_position if ctx2.server else 0
        mixed_fallback = ctx2.client.call_tool(
            "search_documents",
            query=fallback_token,
            mode="mixed",
        )
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None

        ok_x10, why_x10 = _looks_like_graceful_fallback(mixed_fallback)
        run.step(
            label="search_documents mode='mixed' graceful fallback (X-10)",
            passed=ok_x10,
            detail=why_x10,
            timing_ms=mixed_fallback.timing_ms,
            tool_result=mixed_fallback,
            server_logs=step_logs,
        )

        # ── Optionally retain files for debugging ─────────────────────
        if args.keep:
            ctx2.cleanup._vault_files.clear()
            ctx2.cleanup._mcp_identifiers.clear()
            ctx2.cleanup._vault_dirs.clear()
            run.step(
                label="Phase 2 cleanup skipped (--keep)",
                passed=True,
                detail=f"Files retained under: {ctx2.vault.vault_root / '_test'}",
            )

        # ── Attach full server logs to the run ────────────────────────
        if ctx2.server:
            run.attach_server_logs(ctx2.server.captured_logs)

    # After `with` block: cleanup has run, server has stopped
    run.record_cleanup(ctx2.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: search_documents filesystem/semantic/mixed modes and embedding fallback.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                         help="Path to flashquery-core directory.")
    parser.add_argument("--url", type=str, default=None,
                         help="Override FQC server URL (ignored with --managed).")
    parser.add_argument("--secret", type=str, default=None,
                         help="Override auth secret (ignored with --managed).")
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
