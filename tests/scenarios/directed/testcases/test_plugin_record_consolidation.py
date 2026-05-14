#!/usr/bin/env python3
"""
Test: Phase 126 plugin and record consolidation public contracts.

Scenario:
    Exercises the final plugin/record MCP surface through real tool calls:
    register_plugin, unregister_plugin, get_plugin_info, write_record,
    get_record, archive_record, search_records, and clear_pending_reviews.

Coverage points: P-18, P-19, P-20, P-21, P-22, P-23, P-24, P-25
"""
from __future__ import annotations

COVERAGE = ["P-18", "P-19", "P-20", "P-21", "P-22", "P-23", "P-24", "P-25"]

import argparse
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent.parent.parent / "framework"))

from fqc_client import parse_mcp_json
from fqc_test_utils import TestContext, TestRun, expectation_detail

TEST_NAME = "test_plugin_record_consolidation"


def _schema(plugin_id: str, plugin_name: str, table_name: str = "contacts") -> str:
    return f"""
plugin:
  id: {plugin_id}
  name: {plugin_name}
  version: 1.0.0
tables:
  - name: {table_name}
    description: Contacts
    columns:
      - name: name
        type: text
        required: true
      - name: email
        type: text
"""


def _call_step(
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


def _check_step(run: TestRun, label: str, checks: dict[str, bool]) -> bool:
    failed = [name for name, passed in checks.items() if not passed]
    run.step(
        label=label,
        passed=not failed,
        detail="" if not failed else f"Failed: {', '.join(failed)}",
        timing_ms=0,
    )
    return not failed


def run_test(args: argparse.Namespace) -> TestRun:
    run = TestRun(TEST_NAME)
    port_range = tuple(args.port_range) if args.port_range else None
    instance = f"i{run.run_id.replace('-', '')[:8]}"
    plugin_id = f"p126{run.run_id.replace('-', '')[:6]}"
    conflict_plugin_id = f"p126c{run.run_id.replace('-', '')[:5]}"
    missing_record_id = "00000000-0000-4000-8000-000000000000"
    missing_pending_review_id = "00000000-0000-4000-8000-000000000001"

    with TestContext(
        fqc_dir=args.fqc_dir,
        url=args.url,
        secret=args.secret,
        vault_path=getattr(args, "vault_path", None),
        managed=args.managed,
        port_range=port_range,
        require_embedding=False,
    ) as ctx:
        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-18: register_plugin returns structured envelope with was_new:true",
            "register_plugin",
            schema_yaml=_schema(plugin_id, "Phase 126 Plugin"),
            plugin_instance=instance,
        )
        if not ok:
            return run
        ctx.cleanup.track_plugin_registration(plugin_id, instance)
        _check_step(run, "P-18: new registration envelope fields", {
            "plugin_id": payload.get("plugin_id") == plugin_id,
            "was_new true": payload.get("was_new") is True,
            "table_count": payload.get("table_count") == 1,
            "no physical tables field": "tables" not in payload,
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-18: re-registering same plugin returns was_new:false",
            "register_plugin",
            schema_yaml=_schema(plugin_id, "Phase 126 Plugin"),
            plugin_instance=instance,
        )
        if not ok:
            return run
        _check_step(run, "P-18: existing registration envelope fields", {
            "was_new false": payload.get("was_new") is False,
            "status registered": payload.get("status") == "registered",
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-20: get_plugin_info gates schema, tables, and status detail through include",
            "get_plugin_info",
            plugin_id=plugin_id,
            plugin_instance=instance,
            include=["schema", "tables", "status_detail"],
        )
        if not ok:
            return run
        _check_step(run, "P-20: get_plugin_info include payload", {
            "logical tables": payload.get("tables") == ["contacts"],
            "schema included": isinstance(payload.get("schema"), dict),
            "status detail included": isinstance(payload.get("status_detail"), dict),
            "table prefix detail": payload.get("status_detail", {}).get("table_prefix", "").startswith("fqcp_"),
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-21: write_record create rejects missing schema-required fields",
            "write_record",
            mode="create",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            data={},
        )
        if not ok:
            return run
        _check_step(run, "P-21: create validation envelope", {
            "invalid_input": payload.get("error") == "invalid_input",
            "identifier": payload.get("identifier") == f"{plugin_id}.contacts",
            "missing name": payload.get("details", {}).get("missing_fields") == ["name"],
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-21: write_record create returns identification plus include-gated data",
            "write_record",
            mode="create",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            data={"name": "Ada Lovelace", "email": "ada@example.test"},
            include=["data"],
        )
        if not ok:
            return run
        record_id = payload.get("id")
        _check_step(run, "P-21: create success payload", {
            "record id present": isinstance(record_id, str) and len(record_id) > 0,
            "data included": payload.get("data", {}).get("name") == "Ada Lovelace",
        })

        for label, data, expected_field in [
            ("P-21: write_record rejects generated fields", {"name": "Grace", "id": "caller-id"}, "id"),
            ("P-21: write_record rejects unknown fields", {"name": "Grace", "nickname": "Ace"}, "nickname"),
        ]:
            ok, payload, _ = _call_step(
                run,
                ctx,
                label,
                "write_record",
                mode="create",
                plugin_id=plugin_id,
                plugin_instance=instance,
                table="contacts",
                data=data,
            )
            if not ok:
                return run
            _check_step(run, f"{label} envelope", {
                "invalid_input": payload.get("error") == "invalid_input",
                "field": payload.get("details", {}).get("field") == expected_field,
            })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-21: write_record update returns include-gated data",
            "write_record",
            mode="update",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            id=record_id,
            data={"email": "ada-updated@example.test"},
            include=["data"],
        )
        if not ok:
            return run
        _check_step(run, "P-21: update success payload", {
            "same id": payload.get("id") == record_id,
            "updated data": payload.get("data", {}).get("email") == "ada-updated@example.test",
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-22: get_record default include returns data",
            "get_record",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            id=record_id,
        )
        if not ok:
            return run
        _check_step(run, "P-22: get_record default payload", {
            "data included": payload.get("data", {}).get("name") == "Ada Lovelace",
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-22: get_record include:[] suppresses data",
            "get_record",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            id=record_id,
            include=[],
        )
        if not ok:
            return run
        _check_step(run, "P-22: get_record include empty payload", {
            "id present": payload.get("id") == record_id,
            "data omitted": "data" not in payload,
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-22: get_record schema_metadata include",
            "get_record",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            id=record_id,
            include=["schema_metadata"],
        )
        if not ok:
            return run
        _check_step(run, "P-22: get_record schema metadata payload", {
            "schema metadata": payload.get("schema_metadata", {}).get("required_fields") == ["name"],
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-22: get_record missing id returns canonical not_found envelope",
            "get_record",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            id="missing-record",
        )
        if not ok:
            return run
        _check_step(run, "P-22: get_record not_found payload", {
            "not_found": payload.get("error") == "not_found",
            "identifier": payload.get("identifier") == "missing-record",
            "details": payload.get("details") == {"plugin_id": plugin_id, "table": "contacts"},
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-24: search_records returns structured include-gated envelope",
            "search_records",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            filters={"name": "Ada Lovelace"},
            include=["data"],
        )
        if not ok:
            return run
        _check_step(run, "P-24: search_records success envelope", {
            "total one": payload.get("total") == 1,
            "result id": payload.get("results", [{}])[0].get("id") == record_id,
            "data included": payload.get("results", [{}])[0].get("data", {}).get("email") == "ada-updated@example.test",
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-23: archive_record ordered batch returns success plus per-target not_found",
            "archive_record",
            targets=[
                {"plugin_id": plugin_id, "plugin_instance": instance, "table": "contacts", "id": record_id},
                {"plugin_id": plugin_id, "plugin_instance": instance, "table": "contacts", "id": missing_record_id},
            ],
        )
        if not ok:
            return run
        _check_step(run, "P-23: archive_record batch payload", {
            "two results": isinstance(payload, list) and len(payload) == 2,
            "success id": isinstance(payload, list) and payload[0].get("id") == record_id,
            "warning": isinstance(payload, list) and payload[0].get("warnings") == ["archived_at_unavailable"],
            "archived_at omitted": isinstance(payload, list) and "archived_at" not in payload[0],
            "not_found second": isinstance(payload, list) and payload[1].get("error") == "not_found",
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-24: archived records are filtered from search_records",
            "search_records",
            plugin_id=plugin_id,
            plugin_instance=instance,
            table="contacts",
            filters={"name": "Ada Lovelace"},
        )
        if not ok:
            return run
        ctx.cleanup.track_plugin_registration(conflict_plugin_id, instance)
        _check_step(run, "P-24: archived filtering payload", {
            "zero total": payload.get("total") == 0,
            "empty results": payload.get("results") == [],
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-25: clear_pending_reviews list returns row-id based empty envelope",
            "clear_pending_reviews",
            action="list",
            plugin_id=plugin_id,
        )
        if not ok:
            return run
        _check_step(run, "P-25: pending review list payload", {
            "pending zero": payload.get("pending") == 0,
            "items empty": payload.get("items") == [],
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-25: clear_pending_reviews clear with no matching ids returns no_matching_items warning",
            "clear_pending_reviews",
            action="clear",
            plugin_id=plugin_id,
            ids=[missing_pending_review_id],
        )
        if not ok:
            return run
        _check_step(run, "P-25: pending review no-match payload", {
            "cleared zero": payload.get("cleared") == 0,
            "warning": payload.get("warnings") == ["no_matching_items"],
        })

        ok, _, _ = _call_step(
            run,
            ctx,
            "P-19 setup: register plugin with a live record",
            "register_plugin",
            schema_yaml=_schema(conflict_plugin_id, "Phase 126 Conflict Plugin", "leads"),
            plugin_instance=instance,
        )
        if not ok:
            return run
        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-19 setup: create live record for unregister conflict",
            "write_record",
            mode="create",
            plugin_id=conflict_plugin_id,
            plugin_instance=instance,
            table="leads",
            data={"name": "Live Lead"},
        )
        if not ok:
            return run

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-19: unregister_plugin conflicts on live records without force",
            "unregister_plugin",
            plugin_id=conflict_plugin_id,
            plugin_instance=instance,
        )
        if not ok:
            return run
        _check_step(run, "P-19: unregister conflict payload", {
            "conflict": payload.get("error") == "conflict",
            "live count": payload.get("details", {}).get("live_record_count") == 1,
        })

        ok, payload, _ = _call_step(
            run,
            ctx,
            "P-19: unregister_plugin force returns orphan warning",
            "unregister_plugin",
            plugin_id=conflict_plugin_id,
            plugin_instance=instance,
            force=True,
        )
        if not ok:
            return run
        _check_step(run, "P-19: force unregister payload", {
            "status": payload.get("status") == "unregistered",
            "warning": payload.get("warnings") == ["orphaned_records: 1"],
        })

        _call_step(
            run,
            ctx,
            "Cleanup: unregister primary plugin",
            "unregister_plugin",
            plugin_id=plugin_id,
            plugin_instance=instance,
            force=True,
        )

        if args.keep:
            ctx.cleanup._plugin_registrations.clear()
            run.step(label="Cleanup skipped (--keep)", passed=True, detail=f"Plugin instance retained: {instance}")

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
    sys.exit(result.exit_code)


if __name__ == "__main__":
    main()
