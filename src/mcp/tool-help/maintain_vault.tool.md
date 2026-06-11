---
name: maintain_vault
description: "Run administrative vault sync, repair, status, and embedding lifecycle maintenance. Pass {help: true} for full help."
help_hint: "Use maintain_vault for operator-level sync, repair, lifecycle embedding maintenance, and background status checks."
tier: admin
args:
  action: "Required sync, repair, status, lifecycle action, or sync/repair array."
  dry_run: "Optional repair-only preview flag."
  background: "Optional sync background flag."
  job_id: "Required for status."
  embedding_name: "Embedding catalog entry name for core lifecycle actions."
  scope: "Lifecycle scope for backfill_embeddings and rebuild_embeddings."
  max_rows: "Lifecycle row ceiling; 0 means unlimited."
  confirm: "Confirmation string for rebuild_embeddings and retire_embedding."
---

# maintain_vault

## Purpose

Use `maintain_vault` for administrative maintenance when files changed outside FlashQuery, tracked state needs reconciliation, or embedding lifecycle operations need operator control. It can sync external filesystem changes, repair tracked document state, inspect background jobs, and expose the v4.0 embedding lifecycle contract.

The authoritative lifecycle requirements are the external v4.0 requirements spec and test plan in `flashquery-product/Roadmap/Features/Embedding Purpose Dimensions/`. When this help and those documents differ, the external requirements and test plan win.

## Params

| Name | Type | Required | Default | Description |
| --- | --- | --- | --- | --- |
| `action` | string or string[] | yes | none | `sync`, `repair`, `status`, or an array containing `repair` and/or `sync`. |
| `dry_run` | boolean | repair only | `false` | Preview repair effects without writing. |
| `background` | boolean | sync only | `false` | Run sync as a background job. |
| `job_id` | string | status only | none | Background job id to inspect. |
| `embedding_name` | string | action/scope-specific | none | Catalog entry name for core `backfill_embeddings`, `rebuild_embeddings`, and `retire_embedding`. |
| `scope` | object | lifecycle action-specific | none | Entity scope for `backfill_embeddings` and `rebuild_embeddings`. |
| `max_rows` | integer | rebuild only | `0` for backfill | Strict in-scope row ceiling. `0` means unlimited. |
| `confirm` | string | rebuild/retire | none | Must match the effective embedding name. |
| `stale_only` | boolean | rebuild only | `false` | Rebuild only rows whose model stamp is stale. |
| `mismatched_width_only` | boolean | rebuild only | `false` | Rebuild only rows whose dimension stamp is wrong. |
| `drop_stamping_columns` | boolean | retire only | `true` | Retire option for stamping columns. |

## Lifecycle Parameter Matrix

| Action | Required | Optional | Invalid |
| --- | --- | --- | --- |
| `backfill_embeddings` | `scope`; `embedding_name` when core scope needs it | `max_rows`, `dry_run`, `background` | `confirm`, `stale_only`, `mismatched_width_only`, `drop_stamping_columns`, `job_id` |
| `rebuild_embeddings` | `scope`, `max_rows`, `confirm`; `embedding_name` when core scope needs it | `dry_run`, `background`, `stale_only`, `mismatched_width_only` | `drop_stamping_columns`, `job_id` |
| `retire_embedding` | `embedding_name`, `confirm` | `drop_stamping_columns` | `scope`, `max_rows`, `dry_run`, `background`, `stale_only`, `mismatched_width_only`, `job_id` |
| `abort` | `job_id` | none | embedding lifecycle parameters, `dry_run`, `background` |
| `status` | `job_id` | none | `dry_run`, `background` |

## Returns

Returns JSON text for completed maintenance or job status. Sync reports high-level synchronization results. Repair reports reconciliation outcomes and honors `dry_run`. Status returns job-level state for a background job or a not-found expected error.

Lifecycle actions currently validate the public contract and return an expected `unsupported` envelope until the concrete processors are wired. Invalid lifecycle combinations return expected `invalid_input` envelopes with `isError: false` at the MCP boundary.

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

```json
{ "action": "rebuild_embeddings", "embedding_name": "primary", "scope": { "entity_types": ["documents"] }, "max_rows": 1000, "confirm": "primary" }
```

Validates the rebuild contract before lifecycle execution.

## Gotchas

- This is admin-tier and not safe for delegated native access.
- `dry_run` only applies to repair.
- `background` only applies to sync.
- Status is process-local for v1 background jobs; unknown ids return not found.
- Lifecycle actions are not array-combinable. The only valid action array remains `["repair", "sync"]` or the same two legacy actions in either order.
- `max_rows` is a hard pre-work ceiling, not a loop budget. `max_rows: 0` means unlimited. `rebuild_embeddings` requires `max_rows`; `retire_embedding` rejects it.
- For pure-records `rebuild_embeddings`, do not pass top-level `embedding_name`. The expected `confirm` value is derived from resolved plugin work units. One distinct non-null plugin `embedding_name` is allowed; multiple distinct names return `invalid_input` and require narrowing `scope.plugin` or `scope.records.targets`.

## Related Tools

- `list_vault` inspects the filesystem view after maintenance.
- `get_document` verifies a tracked document after repair.
- `manage_directory` changes folder structure directly.
