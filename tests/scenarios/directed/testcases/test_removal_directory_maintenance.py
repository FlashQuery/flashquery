#!/usr/bin/env python3
"""
Test: Phase 127 removal, directory, and vault maintenance public contracts.

Scenario:
    Exercises the final Phase 127 public surface through real MCP calls:
    manage_directory, maintain_vault, and remove_document.

Coverage points: D-rdoc-1, D-rdoc-5, D-rdoc-6, D-rdoc-7,
                 D-mdir-1 through D-mdir-6,
                 D-mvault-1 through D-mvault-6
"""
from __future__ import annotations

COVERAGE = [
    "D-rdoc-1",
    "D-rdoc-5",
    "D-rdoc-6",
    "D-rdoc-7",
    "D-mdir-1",
    "D-mdir-2",
    "D-mdir-3",
    "D-mdir-4",
    "D-mdir-5",
    "D-mdir-6",
    "D-mvault-1",
    "D-mvault-2",
    "D-mvault-3",
    "D-mvault-4",
    "D-mvault-5",
    "D-mvault-6",
]

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import parse_mcp_json
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_removal_directory_maintenance"


def _call_json(
    run: TestRun,
    ctx: TestContext,
    label: str,
    tool: str,
    **kwargs: Any,
) -> tuple[bool, Any, Any]:
    log_mark = ctx.server.log_position if ctx.server else 0
    result = ctx.client.call_tool(tool, **kwargs)
    step_logs = ctx.server.logs_since(log_mark) if ctx.server else None
    payload: Any = None
    detail = expectation_detail(result) or result.error or ""
    passed = result.ok
    if passed:
        try:
            payload = parse_mcp_json(result)
        except Exception as exc:
            passed = False
            detail = f"JSON parse error: {exc}"
    run.step(
        label=label,
        passed=passed,
        detail=detail,
        timing_ms=result.timing_ms,
        tool_result=result,
        server_logs=step_logs,
    )
    return passed, payload, result


def _check(run: TestRun, label: str, checks: dict[str, bool]) -> bool:
    failed = [name for name, passed in checks.items() if not passed]
    run.step(
        label=label,
        passed=not failed,
        detail="" if not failed else f"Failed: {', '.join(failed)}",
        timing_ms=0,
    )
    return not failed


def _track_created_document(ctx: TestContext, payload: dict[str, Any]) -> None:
    path = payload.get("path")
    fq_id = payload.get("fq_id")
    if isinstance(path, str):
        ctx.cleanup.track_file(path)
        parts = Path(path).parts
        for i in range(1, len(parts)):
            ctx.cleanup.track_dir(str(Path(*parts[:i])))
    if isinstance(fq_id, str):
        ctx.cleanup.track_mcp_document(fq_id)


def _untrack_removed_document(ctx: TestContext, payload: dict[str, Any]) -> None:
    path = payload.get("path")
    fq_id = payload.get("fq_id")
    if isinstance(path, str):
        ctx.cleanup._vault_files = [item for item in ctx.cleanup._vault_files if item != path]
    if isinstance(fq_id, str):
        ctx.cleanup._mcp_identifiers = [
            item for item in ctx.cleanup._mcp_identifiers if item != fq_id and item != path
        ]


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    base_dir = f"_test/{TEST_NAME}_{run.run_id}"
    empty_dir = f"{base_dir}/empty"
    non_empty_dir = f"{base_dir}/non-empty"
    sync_dir = f"{base_dir}/external"
    sync_path = f"{sync_dir}/synced.md"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:
        ctx.cleanup.track_dir(base_dir)
        ctx.cleanup.track_dir(empty_dir)
        ctx.cleanup.track_dir(non_empty_dir)
        ctx.cleanup.track_dir(sync_dir)

        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mdir-1/D-mdir-5: manage_directory creates ordered directory results",
            "manage_directory",
            action="create",
            paths=[empty_dir, non_empty_dir],
        )
        if not ok:
            return run
        _check(run, "D-mdir-1: create statuses", {
            "two results": len(payload.get("results", [])) == 2,
            "first created": payload["results"][0].get("status") == "created",
            "second created": payload["results"][1].get("status") == "created",
        })

        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mdir-2: manage_directory idempotent create returns unchanged",
            "manage_directory",
            action="create",
            paths=[empty_dir],
        )
        if not ok:
            return run
        _check(run, "D-mdir-2: unchanged payload", {
            "unchanged": payload.get("results", [{}])[0].get("status") == "unchanged",
        })

        ok, doc_payload, _ = _call_json(
            run,
            ctx,
            "Setup: write_document creates document in non-empty directory",
            "write_document",
            mode="create",
            path=f"{non_empty_dir}/kept.md",
            title="Phase 127 Non Empty Directory",
            content="This document keeps the directory non-empty.",
        )
        if not ok:
            return run
        _track_created_document(ctx, doc_payload)

        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mdir-4/D-mdir-6: manage_directory rejects non-empty and traversal paths",
            "manage_directory",
            action="remove",
            paths=[non_empty_dir, "../outside"],
        )
        if not ok:
            return run
        _check(run, "D-mdir-4/D-mdir-6: per-element errors", {
            "two results": len(payload.get("results", [])) == 2,
            "non-empty conflict": payload["results"][0].get("details", {}).get("reason") == "directory_not_empty",
            "traversal invalid": payload["results"][1].get("error") == "invalid_input",
        })

        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mdir-3: manage_directory removes empty directory",
            "manage_directory",
            action="remove",
            paths=[empty_dir],
        )
        if not ok:
            return run
        _check(run, "D-mdir-3: empty directory removed", {
            "removed": payload.get("results", [{}])[0].get("status") == "removed",
            "absent on disk": not ctx.vault._abs(empty_dir).exists(),
        })

        ctx.create_file(
            sync_path,
            title="Phase 127 External Sync",
            body="External file created outside MCP and indexed by maintain_vault.",
            tags=["phase127-directed"],
        )
        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mvault-1: maintain_vault sync indexes external file",
            "maintain_vault",
            action="sync",
        )
        if not ok:
            return run
        _check(run, "D-mvault-1: sync counts", {
            "sync action": payload.get("actions", [{}])[0].get("action") == "sync",
            "counts object": isinstance(payload.get("actions", [{}])[0].get("counts"), dict),
        })

        ok, get_payload, _ = _call_json(
            run,
            ctx,
            "D-mvault-1: synced file is retrievable",
            "get_document",
            identifiers=sync_path,
        )
        if not ok:
            return run
        _check(run, "D-mvault-1: get_document after sync", {
            "path": get_payload.get("path") == sync_path,
            "title": get_payload.get("title") == "Phase 127 External Sync",
        })

        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mvault-2/D-mvault-4: maintain_vault repair dry_run returns structured result",
            "maintain_vault",
            action="repair",
            dry_run=True,
        )
        if not ok:
            return run
        _check(run, "D-mvault-2/D-mvault-4: repair dry_run result", {
            "repair action": payload.get("actions", [{}])[0].get("action") == "repair",
            "dry_run true": payload.get("actions", [{}])[0].get("dry_run") is True,
            "counts object": isinstance(payload.get("actions", [{}])[0].get("counts"), dict),
        })

        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mvault-3: maintain_vault combined actions run repair before sync",
            "maintain_vault",
            action=["sync", "repair"],
        )
        if not ok:
            return run
        _check(run, "D-mvault-3: combined order", {
            "two actions": len(payload.get("actions", [])) == 2,
            "repair first": payload["actions"][0].get("action") == "repair",
            "sync second": payload["actions"][1].get("action") == "sync",
        })

        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mvault-5: maintain_vault rejects background repair",
            "maintain_vault",
            action="repair",
            background=True,
        )
        if not ok:
            return run
        _check(run, "D-mvault-5: background repair invalid_input", {
            "invalid_input": payload.get("error") == "invalid_input",
            "parameter": payload.get("details", {}).get("parameter") == "background",
        })

        ok, payload, _ = _call_json(
            run,
            ctx,
            "D-mvault-6: maintain_vault unknown status is not_found",
            "maintain_vault",
            action="status",
            job_id="missing",
        )
        if not ok:
            return run
        _check(run, "D-mvault-6: unknown status payload", {
            "not_found": payload.get("error") == "not_found",
        })

        ok, remove_create, _ = _call_json(
            run,
            ctx,
            "Setup: write_document creates document for remove_document",
            "write_document",
            mode="create",
            path=f"{base_dir}/remove-target.md",
            title="Phase 127 Remove Target",
            content="This document is intentionally removed.",
        )
        if not ok:
            return run
        _track_created_document(ctx, remove_create)

        ok, remove_payload, _ = _call_json(
            run,
            ctx,
            "D-rdoc-1/D-rdoc-5: remove_document archives then removes",
            "remove_document",
            identifiers=remove_create["fq_id"],
        )
        if not ok:
            return run
        _untrack_removed_document(ctx, remove_payload)
        _check(run, "D-rdoc-1/D-rdoc-5: removal payload and disk state", {
            "archived status": remove_payload.get("status") == "archived",
            "not removed status": remove_payload.get("status") != "removed",
            "archived_at": isinstance(remove_payload.get("archived_at"), str),
            "source absent": not ctx.vault._abs(remove_create["path"]).exists(),
        })

        ok, search_payload, _ = _call_json(
            run,
            ctx,
            "D-rdoc-5: default search excludes removed archived document",
            "search",
            query="Phase 127 Remove Target",
            entity_types=["documents"],
            mode="filesystem",
        )
        if not ok:
            return run
        _check(run, "D-rdoc-5: removed document absent from default search", {
            "no results": search_payload.get("results") == [],
        })

        ok, batch_create, _ = _call_json(
            run,
            ctx,
            "Setup: write_document creates batch removal target",
            "write_document",
            mode="create",
            path=f"{base_dir}/batch-target.md",
            title="Phase 127 Batch Target",
            content="This document is intentionally removed in a batch.",
        )
        if not ok:
            return run
        _track_created_document(ctx, batch_create)

        ok, batch_payload, _ = _call_json(
            run,
            ctx,
            "D-rdoc-6: remove_document mixed batch preserves input order",
            "remove_document",
            identifiers=[batch_create["path"], f"{base_dir}/missing.md"],
        )
        if not ok:
            return run
        _untrack_removed_document(ctx, batch_payload.get("results", [{}])[0])
        _check(run, "D-rdoc-6: mixed batch payload", {
            "two results": len(batch_payload.get("results", [])) == 2,
            "first success": batch_payload["results"][0].get("path") == batch_create["path"],
            "second not_found": batch_payload["results"][1].get("error") == "not_found",
        })

        bulk_paths: list[str] = []
        for idx in range(6):
            ok, created, _ = _call_json(
                run,
                ctx,
                f"Setup: write_document creates bulk removal target {idx}",
                "write_document",
                mode="create",
                path=f"{base_dir}/bulk-{idx}.md",
                title=f"Phase 127 Bulk {idx}",
                content="Bulk removal warning target.",
            )
            if not ok:
                return run
            _track_created_document(ctx, created)
            bulk_paths.append(created["path"])

        ok, bulk_payload, _ = _call_json(
            run,
            ctx,
            "D-rdoc-7: remove_document bulk removal warning",
            "remove_document",
            identifiers=bulk_paths,
        )
        if not ok:
            return run
        for result in bulk_payload.get("results", []):
            if isinstance(result, dict):
                _untrack_removed_document(ctx, result)
        _check(run, "D-rdoc-7: bulk warning payload", {
            "six results": len(bulk_payload.get("results", [])) == 6,
            "bulk warning": bulk_payload.get("warnings") == ["bulk_removal: 6 items"],
        })

        if args.keep:
            ctx.cleanup._vault_files.clear()
            ctx.cleanup._mcp_identifiers.clear()
            ctx.cleanup._vault_dirs.clear()
            run.step(label="Cleanup skipped (--keep)", passed=True, detail=f"Files retained under: {base_dir}")

        if ctx.server:
            run.attach_server_logs(ctx.server.captured_logs)

    run.record_cleanup(ctx.cleanup_errors)
    return run


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--managed", action="store_true")
    parser.add_argument("--strict-cleanup", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--keep", action="store_true")
    parser.add_argument("--url")
    parser.add_argument("--secret")
    parser.add_argument("--vault-path")
    parser.add_argument("--port-range", nargs=2, type=int)
    parser.add_argument("--fqc-dir", default=str(Path(__file__).resolve().parents[4]))
    args = parser.parse_args()
    result = run_test(args)
    if args.json:
        print(result.to_json())
    else:
        for line in result.summary_lines():
            print(line, file=sys.stderr)
    sys.exit(result.exit_code)


if __name__ == "__main__":
    main()
