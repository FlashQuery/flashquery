---
name: maintain_vault
description: "Run administrative vault sync, repair, or status maintenance for filesystem and tracked document consistency. Pass {help: true} for full help."
help_hint: "Use maintain_vault for operator-level sync, repair, and background status checks after external vault changes."
tier: admin
args:
  action: "Required sync, repair, status, or sync/repair array."
  dry_run: "Optional repair-only preview flag."
  background: "Optional sync background flag."
  job_id: "Required for status."
---

# maintain_vault

## Purpose

Use `maintain_vault` for administrative maintenance when files changed outside FlashQuery or tracked state needs reconciliation. It can sync external filesystem changes, repair tracked document state, or inspect a background sync job. Normal read and write workflows should not need this tool.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `action` | string or string[] | yes | none | `sync`, `repair`, `status`, or an array containing `repair` and/or `sync`. |
| `dry_run` | boolean | repair only | `false` | Preview repair effects without writing. |
| `background` | boolean | sync only | `false` | Run sync as a background job. |
| `job_id` | string | status only | none | Background job id to inspect. |

## Returns

Returns JSON text for completed maintenance or job status. Sync reports high-level synchronization results. Repair reports reconciliation outcomes and honors `dry_run`. Status returns job-level state for a background job or a not-found expected error.

## Examples

```json
{ "action": "sync" }
```

Scans external filesystem changes.

```json
{ "action": "repair", "dry_run": true }
```

Previews reconciliation repairs.

```json
{ "action": ["repair", "sync"] }
```

Runs repair before sync in one request.

## Gotchas

- This is admin-tier and not safe for delegated native access.
- `dry_run` only applies to repair.
- `background` only applies to sync.
- Status is process-local for v1 background jobs; unknown ids return not found.

## Related Tools

- `list_vault` inspects the filesystem view after maintenance.
- `get_document` verifies a tracked document after repair.
- `manage_directory` changes folder structure directly.
