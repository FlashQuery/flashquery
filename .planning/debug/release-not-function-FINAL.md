---
status: resolved
updated: 2026-05-14T03:05:00Z
---

# "release is not a function" Root Cause Analysis

## Issue Summary

6 tests in `tests/unit/document-tools.test.ts` fail with `TypeError: release is not a function` when executing `reconcile_documents` tool:

```
Error at src/mcp/tools/documents.ts:1148 in finally block:
  finally {
    release();  // TypeError: release is not a function
  }
```

**Failing tests:**
1. reconcile_documents > reports nothing to do when all DB rows have valid vault files
2. reconcile_documents > updates DB path when a moved file is found
3. reconcile_documents > marks DB row archived when file is missing
4. reconcile_documents > dry_run mode reports changes but does NOT update DB
5. TSA-07 > reconcile_documents acquires scanMutex
6. TSA-07 > reconcile_documents releases scanMutex on error

## Root Cause

**The issue is in the test mock setup, not the production code.**

### The Problem Chain

1. **Module level (lines 68-74):** Mock `scanMutex.acquire` is defined
   ```typescript
   const { mockAcquire } = vi.hoisted(() => ({
     mockAcquire: vi.fn().mockResolvedValue(() => {}),
   }));
   
   vi.mock('../../src/services/scanner.js', () => ({
     scanMutex: { acquire: mockAcquire },
   }));
   ```

2. **beforeEach (line 1163):** Each test clears ALL mocks
   ```typescript
   describe('reconcile_documents', () => {
     beforeEach(() => {
       vi.clearAllMocks();  // ← This clears mockAcquire's configuration!
       vi.mocked(fs.existsSync).mockReturnValue(true);
       vi.mocked(embeddingProvider.embed).mockResolvedValue(Array(1536).fill(0.1));
     });
   ```

3. **Effect of vi.clearAllMocks():**
   - Resets `mockAcquire` from `vi.fn().mockResolvedValue(() => {})`
   - To a bare `vi.fn()` with NO return value configured
   - Bare `vi.fn()` returns `undefined` when called

4. **Code execution (documents.ts:1040):**
   ```typescript
   const release = await scanMutex.acquire();
   // mockAcquire() was called
   // It returned: Promise<undefined> (instead of Promise<() => void>)
   // await resolved to: undefined
   // release = undefined
   ```

5. **Error (documents.ts:1148):**
   ```typescript
   finally {
     release();  // TypeError: undefined is not a function
   }
   ```

### Why This Happens

Vitest's `vi.clearAllMocks()` resets **all mock state**, including:
- Call history
- Return value configuration (mockResolvedValue)
- Mock implementation

The `mockAcquire` variable itself still references the same mock function object, but that object's configuration has been reset to defaults. A bare `vi.fn()` with no configuration returns `undefined`.

### Why Some Tests Pass

Some tests (like "reports nothing to do") have data with no missing rows, which causes an early return before the code reaches the finally block in certain execution paths. However, the finally block ALWAYS executes - those tests may pass for other reasons (like the test framework handling the error differently in early-return paths).

## Evidence

**File:** `tests/unit/document-tools.test.ts`

- **Line 68-69:** `mockAcquire` definition with `vi.hoisted()`
- **Line 73:** `scanMutex: { acquire: mockAcquire }` — mock assignment
- **Line 1163:** `vi.clearAllMocks()` — resets mockAcquire configuration
- **No line between 1163 and 1192:** No reconfiguration of mockAcquire after clearAllMocks

**File:** `src/mcp/tools/documents.ts`

- **Line 17:** Import `scanMutex` from services
- **Line 1040:** `const release = await scanMutex.acquire();`
- **Line 1148:** `release();` in finally block

**Expected behavior (from real implementation):**
- `Mutex.acquire()` from `async-mutex` returns `Promise<() => void>`
- The released function should be callable

## Solution

Reconfigure `mockAcquire` after `vi.clearAllMocks()` in the reconcile_documents beforeEach:

```typescript
describe('reconcile_documents', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(embeddingProvider.embed).mockResolvedValue(Array(1536).fill(0.1));
    
    // ADD THIS LINE to restore mock configuration after clearAllMocks:
    vi.mocked(mockAcquire).mockResolvedValue(() => {});
  });
```

This ensures that `scanMutex.acquire()` always returns a Promise that resolves to a callable release function, matching the contract of the real `async-mutex` Mutex class.

## Impact

- **Scope:** Test suite only (no impact on production code)
- **Files affected:** `tests/unit/document-tools.test.ts`
- **Fix complexity:** 1 line addition in the `reconcile_documents` beforeEach
- **Test impact:** Will enable 6 currently-failing tests to pass

## Additional Notes

The TSA-07 tests have misleading comments (lines 1366-1368, 1393-1394) suggesting they verify mutex behavior, but they don't actually validate that the mock is working correctly. The fix will ensure these tests properly exercise the mutex acquire/release lifecycle.
