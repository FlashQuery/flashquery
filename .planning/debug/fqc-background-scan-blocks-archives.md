---
status: resolved
updated: 2026-05-14T03:05:00Z
---

# FQC Bug: Background File Scans Block Archive Operations

**Status:** ✅ RESOLVED  
**Severity:** Critical (blocks SC-01/SC-02 coverage at scale)  
**Discovered:** 2026-04-15  
**Fixed:** 2026-04-15  
**Reproducibility:** 100% (consistent on Mac and Linux) — Now Fixed

---

## Summary

When `force_file_scan(background=True)` is called on a vault with 300+ files, subsequent archive operations timeout waiting for the background scan to complete. The background scan appears to block archive operations rather than running concurrently.

---

## Expected Behavior

- `force_file_scan(background=True)` should start an asynchronous scan that doesn't block other operations
- Archive operations should execute independently and concurrently with background file scans
- Archive is a simple metadata operation (marking documents as archived) that shouldn't need to wait for file scanning to complete

---

## Actual Behavior

- Archive operations timeout at exactly 30 seconds (HTTP timeout)
- Server logs show the background file scan is still running during archive operation timeouts
- Affects archive operations 1-6 consistently; operations 7+ pass after scan completes
- Reproduces on both Mac and Linux systems

---

## Technical Details

### Test Environment

- **Project:** FlashQuery Core (flashquery-core)
- **Test:** `tests/scenarios/testcases/test_large_vault_scale.py`
- **Invocation:** `python3 test_large_vault_scale.py --scale-size 300 --managed`
- **Test Scale:** 300 total operations (60 external files + 90 creates + 90 updates + 60 archives)

### Failure Pattern

| Step | Operation | Status | Duration | Notes |
|------|-----------|--------|----------|-------|
| 187 | `force_file_scan (mid-test external injection)` | PASS | 5ms | Returns immediately (background=True) |
| 189 | `archive_document (1/60)` | **FAIL** | 30002ms | Timeout: scan still running |
| 190 | `archive_document (2/60)` | **FAIL** | 30020ms | Timeout: scan still running |
| 191 | `archive_document (3/60)` | **FAIL** | 30007ms | Timeout: scan still running |
| 192 | `archive_document (4/60)` | **FAIL** | 30013ms | Timeout: scan still running |
| 193 | `archive_document (5/60)` | **FAIL** | 30019ms | Timeout: scan still running |
| 194 | `archive_document (6/60)` | **FAIL** | 30014ms | Timeout: scan still running |
| 195 | `archive_document (7/60)` | PASS | 3980ms | Scan finally complete |
| 196+ | `archive_document (8-60)` | PASS | ~800ms each | No contention after scan completes |

### Server Logs During Timeout

When archive operations timeout, server logs show the background scan is still active:

```
[2026-04-15 18:02:26 REQ:----] INFO   [SCAN-02] content changed: "_test/319e3cc6/bucket_6/doc_00066.md"
[2026-04-15 18:02:26 REQ:----] DEBUG  [PLG-03] CONTENT CHANGED branch: propagating fqc_id
[2026-04-15 18:02:26 REQ:----] DEBUG  Propagation context: oldId=..., newId=..., documentPath=...
[2026-04-15 18:02:27 REQ:----] INFO   Successfully propagated fqc_id in N tables
[2026-04-15 18:02:27 REQ:----] WARN   [SCAN-EMBED] re-embed failed: Semantic search unavailable
```

The scan is actively:
1. Computing file hashes
2. Detecting content changes
3. Propagating fqc_ids to plugin tables
4. Attempting re-embedding

### Scale Dependency

- **At scale=20 (default):** Test passes all 26 steps ✓
- **At scale=100:** Likely fails (not tested yet)
- **At scale=300:** Consistently fails at steps 189-194 (245/250 passing)

---

## Test Case Details

### Step 187 Setup
```python
# Inject external files during update phase
for i in range(num_external):
    file_path = test_root / f"bucket_{i % 10}" / f"doc_{i:05d}.md"
    file_path.write_text(...)
    
# Trigger background scan
scan_result = ctx.client.call_tool("force_file_scan", background=True)
time.sleep(25)  # Wait for scan to complete
```

### Steps 189-194: Archive Operations
```python
for i in range(num_archives):
    result = ctx.client.call_tool("archive_document", identifiers=doc_ids[i])
    # FAIL: HTTP 30-second timeout
```

---

## Root Cause Hypothesis

1. **Hypothesis A (Most Likely):** Background file scans acquire a write lock or exclusive access that blocks archive operations
   - Evidence: Archive ops timeout while scan is active; ops succeed once scan completes
   - Mechanism: Scan propagates fqc_ids to plugin tables (requires DB lock?)

2. **Hypothesis B:** Archive operations trigger their own file scan which queues behind the background scan
   - Evidence: Archive ops have long latency (3980ms for first one after scan)
   - Mechanism: Mutual blocking between archive and scan operations

3. **Hypothesis C:** FQC connection pool or session is exhausted by the background scan
   - Evidence: Multiple archive ops fail simultaneously
   - Mechanism: Background scan holds connections, starving archive requests

---

## Files to Investigate

### In flashquery-core/src:
- `index.ts` - Server startup and tool registration
- `mcp/tools/*.ts` - Tool implementations
  - `archive_document` implementation
  - `force_file_scan` implementation (background flag handling)
- `storage/supabase.ts` - DB access patterns
- `storage/vault.ts` - File system operations and locking

### Test file:
- `tests/scenarios/testcases/test_large_vault_scale.py` - Lines 187-194 showing the failure pattern

---

## Coverage Impact

**Affected Coverage Points:**
- SC-01: Mixed-operation correctness at scale (blocked)
- SC-02: Search correctness at scale (blocked)

**Test cannot validate:**
- Sustained archive operations at 300+ file scale
- Concurrent file scanning and archival behavior
- State consistency under high-load concurrent operations

---

## Workarounds (Temporary)

1. **Reduce test scale:** Use `--scale-size 100` or less (not yet confirmed working)
2. **Remove mid-test injection:** Comment out step 187 external file injection
3. **Use synchronous scans:** Change `background=True` to `background=False` (but then needs 30+ second timeout)

---

## Next Steps for Investigation

### Phase 1: Isolate Lock Contention
1. Check if `force_file_scan` acquires DB locks
2. Check if archive operations wait for DB locks
3. Trace lock acquisition order and duration

### Phase 2: Verify Concurrency Model
1. Confirm archive and scan are supposed to run concurrently
2. Check FQC's threading/async model
3. Verify no implicit serialization in code

### Phase 3: Identify Bottleneck
1. Profile `force_file_scan` execution time at 300+ files
2. Measure archive operation latency during active scan
3. Check connection pool exhaustion hypothesis

### Phase 4: Apply Fix
Once root cause is confirmed, fix could involve:
- Removing lock contention (use read locks instead of write locks)
- Implementing operation queue/priority
- Allowing archive to run independently of scan
- Increasing connection pool size

---

## Completion Log

**Date Fixed:** 2026-04-15  
**Root Cause:** Global `scanMutex` in `targetedScan()` was blocking all write operations (including archive) for 4+ minutes during background file scans.

**Fix Applied:** 
- Removed global `scanMutex` acquisition from `targetedScan()` in `src/mcp/utils/resolve-document.ts`
- Kept per-file mutex for same-file concurrency control
- Allows archives on different files to proceed independently during background scans

**Commit:** b845702

**Test Results:** 
- ✅ test_large_vault_scale.py at scale=300: **250/250 PASS**
- No timeouts on any archive operations
- SC-01 and SC-02 coverage points now unblocked

**Status:** RESOLVED
