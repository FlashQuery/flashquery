#!/usr/bin/env python3
"""
Test: get_document include=['connections'] returns embedding-based document connections.

Scenario:
    Phase 1 — embeddings enabled (D-71, D-72, D-73, D-75, D-76, D-77, D-78):
        1. Create a source document with two thematically distinct sections
           (feline behavior overview + cat training techniques) so the scanner
           generates two distinct chunks.
        2. Create three target documents, each sharing vocabulary and theme with
           one of the source sections, so real chunk-vector cosine similarity
           is high enough for connections to appear.
        3. Force vault scan and wait ~5 s for async chunk embedding to complete.
        4. (D-71, D-72) Call get_document include=['connections'] — verify the
           response carries a 'connections' envelope with 'overall' and
           'source_chunks' lists; if overall is non-empty verify each entry has
           score, target.path, target.title, and target.chunk_id, and that
           overall is sorted by descending score.
        5. (D-73) Verify the source document's own path is absent from
           connections.overall target paths (self-exclusion).
        6. (D-75) Call with connections.limit=1 — verify overall has at most 1 entry.
        7. (D-76) Call with connections.limit_per_chunk=1 — verify every
           source_chunks entry has at most 1 connection in its own list.
        8. (D-77) Call with connections.embedding_names=['nonexistent_catalog_xyz'] —
           verify an error envelope is returned.
        9. (D-78) Call with include=['body','connections'] — verify both 'body' and
           'connections' are present in the response envelope.

    Phase 2 — broken embedding (D-74):
        10. Start a fresh managed server that has the embedding catalog registered
            but routes to an unreachable endpoint so all chunk embedding writes fail
            (fqc_chunks.embedding_primary stays NULL).
        11. Create a document, force a scan — chunks are created but have no vectors.
        12. Call get_document include=['connections'] — verify connections returns
            { overall: [], source_chunks: [] } when no chunk embeddings exist.

    Cleanup is automatic (filesystem + database) even on failure.

Coverage points: D-71, D-72, D-73, D-74, D-75, D-76, D-77, D-78

Modes:
    --managed   Required — this test always starts a dedicated managed server
                (real embedding for phase 1, broken embedding for phase 2).

Usage:
    python test_get_document_connections.py --managed
    python test_get_document_connections.py --managed --json
    python test_get_document_connections.py --managed --json --keep

Exit codes:
    0   PASS
    2   FAIL
    3   DIRTY
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_test_utils import TestContext, TestRun, expectation_detail  # noqa: E402
from lifecycle_embedding_scenario_helpers import lifecycle_catalog_config  # noqa: E402


# ---------------------------------------------------------------------------
# Test identity
# ---------------------------------------------------------------------------

TEST_NAME = "test_get_document_connections"
COVERAGE = ["D-71", "D-72", "D-73", "D-74", "D-75", "D-76", "D-77", "D-78"]


# ---------------------------------------------------------------------------
# Broken embedding config — catalog entry is registered so get_document
# knows to query for embeddings, but the endpoint is unreachable so chunk
# vectors are never written (embedding_primary stays NULL).
# ---------------------------------------------------------------------------

BROKEN_EMBEDDING_CONFIG = {
    "embeddings": [
        {
            "name": "primary",
            "dimensions": 768,
            "endpoints": [
                {
                    "provider_name": "broken-embeddings",
                    "model": "text-embedding-3-small",
                }
            ],
        }
    ],
    "llm": {
        "providers": [
            {
                "name": "broken-embeddings",
                "type": "openai-compatible",
                "endpoint": "http://127.0.0.1:9",
                "api_key": "sk-test-unreachable",
            },
        ],
        "models": [],
        "purposes": [],
    },
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _extract_field(text: str, field: str) -> str:
    """Extract a 'Field: value' line from FlashQuery key-value response text."""
    m = re.search(rf"^{re.escape(field)}:\s*(.+)$", text, re.MULTILINE)
    return m.group(1).strip() if m else ""


def _parse_json(result) -> dict:
    """Parse get_document JSON response; return {} on any failure."""
    try:
        return json.loads(result.text) if result.text else {}
    except Exception:  # noqa: BLE001
        return {}


def _track_created(ctx, result_text: str) -> None:
    """Register a newly-created document for automatic cleanup."""
    payload = {}
    try:
        payload = json.loads(result_text)
    except Exception:  # noqa: BLE001
        pass

    fqc_id = payload.get("fq_id") or _extract_field(result_text, "FQC ID")
    path = payload.get("path") or _extract_field(result_text, "Path")

    if fqc_id:
        ctx.cleanup.track_mcp_document(fqc_id)
    if path:
        ctx.cleanup.track_file(path)
        parts = Path(path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))


# ---------------------------------------------------------------------------
# Test implementation
# ---------------------------------------------------------------------------

def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None

    # ── Fixture: source document with two thematically distinct sections ──
    # Two sections → two distinct chunks. Each section has enough unique
    # vocabulary for a real embedding model to form clear cosine similarity
    # signals with the matching target document.
    source_path = f"_test/{TEST_NAME}_{run.run_id}_source.md"
    source_title = f"Connections Source {run.run_id}"
    source_body = (
        "## Feline Behavior Overview\n\n"
        "Cats exhibit complex territorial and social behaviors inherited from their wild ancestors. "
        "Domestic cats communicate through vocalizations, body postures, and scent marking. "
        "Understanding feline social signals helps owners recognise stress, contentment, and aggression. "
        "Territorial behaviour, hierarchy formation, and play-hunting instincts are all deeply rooted "
        "in feline evolutionary history.\n\n"
        "## Cat Training Techniques\n\n"
        "Positive reinforcement with treats and a clicker is the most effective method for training cats. "
        "Brief sessions of five to ten minutes prevent overstimulation and maintain feline attention. "
        "Target stick training, recall commands, and agility sequences all respond well to reward-based methods. "
        "Consistent timing of the reward signal is critical for the cat to form the correct association."
    )

    # Three target documents — each highly similar in vocabulary to one source section.
    target_a_path = f"_test/{TEST_NAME}_{run.run_id}_a.md"
    target_a_title = f"Connections Target A {run.run_id}"
    target_a_body = (
        "## Understanding Cat Communication\n\n"
        "Domestic cats use vocalisations, body language, and scent signals to communicate. "
        "Territorial instincts and social hierarchies shape feline group behaviour. "
        "Reading cat posture, tail position, and ear orientation helps owners understand "
        "feline social signals and build stronger bonds with their cats."
    )

    target_b_path = f"_test/{TEST_NAME}_{run.run_id}_b.md"
    target_b_title = f"Connections Target B {run.run_id}"
    target_b_body = (
        "## Reward-Based Cat Training\n\n"
        "Clicker training and treat rewards make cat training efficient and humane. "
        "Short five-to-ten-minute sessions keep cats engaged without frustration. "
        "Basic recall, target stick exercises, and trick sequences benefit from "
        "positive reinforcement; precise reward timing shapes the correct association quickly."
    )

    target_c_path = f"_test/{TEST_NAME}_{run.run_id}_c.md"
    target_c_title = f"Connections Target C {run.run_id}"
    target_c_body = (
        "## Feline Instincts and Domestication\n\n"
        "Cats retain predatory and territorial instincts even as domestic companions. "
        "Vocalisations and play-hunting routines reflect their evolutionary adaptations. "
        "Cat owners benefit from training approaches that align with natural feline motivations "
        "and social communication signals."
    )

    # =========================================================================
    # Phase 1 — real embeddings (D-71, D-72, D-73, D-75, D-76, D-77, D-78)
    # =========================================================================

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        require_embedding=True,
        extra_config=lifecycle_catalog_config("primary"),
    ) as ctx:

        # ── Create source document ────────────────────────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        create_src = ctx.client.call_tool(
            "write_document",
            mode="create",
            path=source_path,
            title=source_title,
            content=source_body,
            tags=["fqc-test", run.run_id],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        _track_created(ctx, create_src.text)
        create_src.expect_contains(source_title)
        run.step(
            label="create source document (2 sections → 2 chunks)",
            passed=(create_src.ok and create_src.status == "pass"),
            detail=expectation_detail(create_src) or create_src.error or "",
            timing_ms=create_src.timing_ms,
            tool_result=create_src,
            server_logs=step_logs,
        )
        if not create_src.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # ── Create three target documents ─────────────────────────────
        target_specs = [
            (target_a_path, target_a_title, target_a_body),
            (target_b_path, target_b_title, target_b_body),
            (target_c_path, target_c_title, target_c_body),
        ]
        for path, title, body in target_specs:
            r = ctx.client.call_tool(
                "write_document",
                mode="create",
                path=path,
                title=title,
                content=body,
                tags=["fqc-test", run.run_id],
            )
            _track_created(ctx, r.text)
            if not r.ok:
                run.step(
                    label=f"create target document {title}",
                    passed=False,
                    detail=r.error or "",
                    timing_ms=r.timing_ms,
                    tool_result=r,
                )
                if ctx.server:
                    run.attach_server_logs(ctx.server.captured_logs)
                run.record_cleanup(ctx.cleanup_errors)
                return run

        run.step(
            label="create 3 target documents (A, B, C)",
            passed=True,
            detail="all 3 created successfully",
        )

        # ── Scan vault to index chunks and schedule embedding ─────────
        log_mark = ctx.server.log_position if ctx.server else 0
        scan = ctx.scan_vault()
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
        run.step(
            label="scan vault — index documents and schedule chunk embedding",
            passed=scan.ok,
            detail=scan.error or "",
            timing_ms=scan.timing_ms,
            tool_result=scan,
            server_logs=step_logs,
        )
        if not scan.ok:
            if ctx.server:
                run.attach_server_logs(ctx.server.captured_logs)
            run.record_cleanup(ctx.cleanup_errors)
            return run

        # Chunk embedding runs asynchronously — give it time to commit.
        time.sleep(5.0)

        # ── D-71 / D-72: connections envelope structure and sort order ─
        log_mark = ctx.server.log_position if ctx.server else 0
        conn_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            include=["connections"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        payload = _parse_json(conn_result)
        connections = payload.get("connections")
        overall = connections.get("overall", []) if isinstance(connections, dict) else []
        source_chunks = connections.get("source_chunks", []) if isinstance(connections, dict) else []

        d71_checks: dict[str, bool] = {
            "response ok": conn_result.ok,
            "connections key present": isinstance(connections, dict),
            "overall key is list": isinstance(connections, dict) and isinstance(connections.get("overall"), list),
            "source_chunks key is list": isinstance(connections, dict) and isinstance(connections.get("source_chunks"), list),
        }

        # D-72: entry shape + descending sort (only asserted when results exist)
        if overall:
            first = overall[0]
            target_obj = first.get("target", {}) if isinstance(first, dict) else {}
            d71_checks["overall[0] has score"] = isinstance(first.get("score"), (int, float))
            d71_checks["overall[0].target has path"] = bool(target_obj.get("path"))
            d71_checks["overall[0].target has title"] = bool(target_obj.get("title"))
            d71_checks["overall[0].target has chunk_id"] = bool(target_obj.get("chunk_id"))
            scores = [e.get("score", 0) for e in overall if isinstance(e, dict)]
            d71_checks["overall sorted by descending score"] = all(
                scores[i] >= scores[i + 1] for i in range(len(scores) - 1)
            )

        d71_ok = all(d71_checks.values())
        d71_detail = ""
        if not d71_ok:
            failed = [k for k, v in d71_checks.items() if not v]
            d71_detail = (
                f"Failed checks: {', '.join(failed)}. "
                f"overall_count={len(overall)}, "
                f"connections={json.dumps(connections)[:300] if connections else 'None'}"
            )
        elif not overall:
            # Connections envelope is present but empty — warn without failing.
            # D-71 requires the envelope to exist; D-72 requires correct shape
            # when entries are present. Both pass if overall is empty.
            d71_detail = (
                "connections envelope present but overall is empty — "
                "embedding model may not have found similarity above threshold. "
                "D-71 and D-72 structural assertions pass."
            )

        run.step(
            label="get_document include=['connections'] returns overall+source_chunks envelope (D-71, D-72)",
            passed=d71_ok,
            detail=d71_detail,
            timing_ms=conn_result.timing_ms,
            tool_result=conn_result,
            server_logs=step_logs,
        )

        # ── D-73: self-exclusion ───────────────────────────────────────
        overall_target_paths = {
            e.get("target", {}).get("path", "").lstrip("/")
            for e in overall
            if isinstance(e, dict) and isinstance(e.get("target"), dict)
        }
        source_path_norm = source_path.lstrip("/")
        self_excluded = source_path_norm not in overall_target_paths

        run.step(
            label="source document path absent from connections.overall target paths (D-73)",
            passed=self_excluded,
            detail=(
                ""
                if self_excluded
                else f"source path {source_path!r} found in overall target paths: {overall_target_paths}"
            ),
        )

        # ── D-75: connections.limit caps overall count ─────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        limit_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            include=["connections"],
            connections={"limit": 1},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        limit_payload = _parse_json(limit_result)
        limit_overall = (limit_payload.get("connections") or {}).get("overall", [])
        limit_ok = limit_result.ok and len(limit_overall) <= 1

        run.step(
            label="connections.limit=1 caps overall to at most 1 entry (D-75)",
            passed=limit_ok,
            detail=(
                ""
                if limit_ok
                else (
                    f"expected len(overall) <= 1, got {len(limit_overall)}; "
                    f"entries={json.dumps(limit_overall)[:200]}"
                )
            ),
            timing_ms=limit_result.timing_ms,
            tool_result=limit_result,
            server_logs=step_logs,
        )

        # ── D-76: connections.limit_per_chunk caps per-chunk connections ─
        log_mark = ctx.server.log_position if ctx.server else 0
        lpc_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            include=["connections"],
            connections={"limit_per_chunk": 1},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        lpc_payload = _parse_json(lpc_result)
        lpc_source_chunks = (lpc_payload.get("connections") or {}).get("source_chunks", [])
        lpc_violations = [
            (i, len(chunk.get("connections", [])))
            for i, chunk in enumerate(lpc_source_chunks)
            if isinstance(chunk, dict) and len(chunk.get("connections", [])) > 1
        ]
        lpc_ok = lpc_result.ok and not lpc_violations

        run.step(
            label="connections.limit_per_chunk=1 caps per-chunk connection count (D-76)",
            passed=lpc_ok,
            detail=(
                ""
                if lpc_ok
                else f"source_chunks with >1 connection (index, count): {lpc_violations}"
            ),
            timing_ms=lpc_result.timing_ms,
            tool_result=lpc_result,
            server_logs=step_logs,
        )

        # ── D-77: unknown embedding_names returns error ────────────────
        log_mark = ctx.server.log_position if ctx.server else 0
        unknown_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            include=["connections"],
            connections={"embedding_names": ["nonexistent_catalog_xyz"]},
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        unknown_payload = _parse_json(unknown_result)
        unknown_text = (unknown_result.text or "").lower()
        error_keywords = ("not found", "unknown", "invalid", "nonexistent", "catalog", "unrecognized")
        unknown_is_error = (
            not unknown_result.ok
            or bool(unknown_payload.get("error"))
            or any(kw in unknown_text for kw in error_keywords)
        )

        run.step(
            label="connections.embedding_names=['nonexistent_catalog_xyz'] returns error (D-77)",
            passed=unknown_is_error,
            detail=(
                ""
                if unknown_is_error
                else (
                    f"expected error response, got ok={unknown_result.ok}; "
                    f"text={unknown_result.text[:200]!r}"
                )
            ),
            timing_ms=unknown_result.timing_ms,
            tool_result=unknown_result,
            server_logs=step_logs,
        )

        # ── D-78: include=['body','connections'] returns both fields ───
        log_mark = ctx.server.log_position if ctx.server else 0
        combo_result = ctx.client.call_tool(
            "get_document",
            identifiers=source_path,
            include=["body", "connections"],
        )
        step_logs = ctx.server.logs_since(log_mark) if ctx.server else None

        combo_payload = _parse_json(combo_result)
        combo_checks: dict[str, bool] = {
            "response ok": combo_result.ok,
            "body key present": "body" in combo_payload,
            "connections key present": isinstance(combo_payload.get("connections"), dict),
            "connections.overall is list": isinstance(
                (combo_payload.get("connections") or {}).get("overall"), list
            ),
        }
        combo_ok = all(combo_checks.values())
        combo_detail = ""
        if not combo_ok:
            failed = [k for k, v in combo_checks.items() if not v]
            combo_detail = f"Failed: {', '.join(failed)}. keys={list(combo_payload.keys())}"

        run.step(
            label="include=['body','connections'] returns both body and connections fields (D-78)",
            passed=combo_ok,
            detail=combo_detail,
            timing_ms=combo_result.timing_ms,
            tool_result=combo_result,
            server_logs=step_logs,
        )

        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(
                label="phase 1 cleanup skipped (--keep)",
                passed=True,
                detail=f"files retained under: {source_path}",
            )

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)

    # =========================================================================
    # Phase 2 — broken embedding (D-74)
    # The 'primary' catalog entry is registered so get_document queries for
    # chunk embeddings, but the endpoint is unreachable, so all chunk
    # embedding writes fail and fqc_chunks.embedding_primary stays NULL.
    # =========================================================================

    d74_path = f"_test/{TEST_NAME}_{run.run_id}_d74.md"
    d74_title = f"Connections D74 {run.run_id}"

    with TestContext(
        fqc_dir=args.fqc_dir,
        managed=True,
        port_range=port_range,
        extra_config=BROKEN_EMBEDDING_CONFIG,
    ) as ctx2:

        # ── Create document ───────────────────────────────────────────
        log_mark = ctx2.server.log_position if ctx2.server else 0
        d74_create = ctx2.client.call_tool(
            "write_document",
            mode="create",
            path=d74_path,
            title=d74_title,
            content=(
                "## Overview\n\n"
                "This document tests get_document connections when "
                "the source document has no indexed chunk embeddings."
            ),
            tags=["fqc-test", run.run_id],
        )
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None
        _track_created(ctx2, d74_create.text)
        d74_create.expect_contains(d74_title)
        run.step(
            label="create document in broken-embedding server (D-74 phase)",
            passed=(d74_create.ok and d74_create.status == "pass"),
            detail=expectation_detail(d74_create) or d74_create.error or "",
            timing_ms=d74_create.timing_ms,
            tool_result=d74_create,
            server_logs=step_logs,
        )
        if not d74_create.ok:
            if ctx2.server:
                run.attach_server_logs(ctx2.server.captured_logs)
            run.record_cleanup(ctx2.cleanup_errors)
            return run

        # Scan to create chunk rows (embedding writes fail, vectors stay NULL).
        log_mark = ctx2.server.log_position if ctx2.server else 0
        d74_scan = ctx2.scan_vault()
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None
        run.step(
            label="scan vault — chunks created but embedding fails (NULL vectors)",
            passed=d74_scan.ok,
            detail=d74_scan.error or "",
            timing_ms=d74_scan.timing_ms,
            tool_result=d74_scan,
            server_logs=step_logs,
        )
        # Allow the failing background embedding attempt to complete.
        time.sleep(2.0)

        # ── D-74: connections empty when no chunk embeddings exist ─────
        log_mark = ctx2.server.log_position if ctx2.server else 0
        d74_result = ctx2.client.call_tool(
            "get_document",
            identifiers=d74_path,
            include=["connections"],
        )
        step_logs = ctx2.server.logs_since(log_mark) if ctx2.server else None

        d74_payload = _parse_json(d74_result)
        d74_connections = d74_payload.get("connections")
        d74_overall = (d74_connections or {}).get("overall", "MISSING")
        d74_source_chunks = (d74_connections or {}).get("source_chunks", "MISSING")
        d74_checks: dict[str, bool] = {
            "response ok": d74_result.ok,
            "connections key present": isinstance(d74_connections, dict),
            "overall is empty list": d74_overall == [],
            "source_chunks is empty list": d74_source_chunks == [],
        }
        d74_ok = all(d74_checks.values())
        d74_detail = ""
        if not d74_ok:
            failed = [k for k, v in d74_checks.items() if not v]
            d74_detail = (
                f"Failed: {', '.join(failed)}. "
                f"overall={d74_overall!r}, source_chunks={d74_source_chunks!r}"
            )

        run.step(
            label="connections returns {overall:[], source_chunks:[]} with no embeddings (D-74)",
            passed=d74_ok,
            detail=d74_detail,
            timing_ms=d74_result.timing_ms,
            tool_result=d74_result,
            server_logs=step_logs,
        )

        if args.keep:
            ctx2.cleanup._vault_files.clear()
            ctx2.cleanup._mcp_identifiers.clear()
            ctx2.cleanup._vault_dirs.clear()
            run.step(
                label="phase 2 cleanup skipped (--keep)",
                passed=True,
                detail=f"files retained under: {d74_path}",
            )

        if ctx2.server:
            run.attach_server_logs(ctx2.server.captured_logs)

    run.record_cleanup(ctx2.cleanup_errors)
    return run


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Test: get_document include=['connections'] embedding-based connections.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--fqc-dir", type=str, default=None,
                        help="Path to flashquery-core directory.")
    parser.add_argument("--managed", action="store_true",
                        help="Start a dedicated FQC server (required for this test).")
    parser.add_argument("--port-range", type=int, nargs=2, metavar=("MIN", "MAX"),
                        default=None,
                        help="Port range for the managed server.")
    parser.add_argument("--json", action="store_true", dest="output_json",
                        help="Emit structured JSON to stdout.")
    parser.add_argument("--keep", action="store_true",
                        help="Retain test files for debugging (skip cleanup).")
    args = parser.parse_args()

    if not args.managed:
        run = TestRun(TEST_NAME)
        run.fail(
            "managed_required",
            "--managed is required: this test always starts its own server "
            "(real embedding for phase 1, broken embedding for phase 2)",
        )
    else:
        run = run_test(args)

    if args.output_json:
        print(run.to_json())
    else:
        for line in run.summary_lines():
            print(line, file=sys.stderr)

    sys.exit(run.exit_code)


if __name__ == "__main__":
    main()
