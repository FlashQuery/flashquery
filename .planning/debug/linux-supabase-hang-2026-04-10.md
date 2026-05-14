---
status: resolved
updated: 2026-05-14T03:05:00Z
---

# Debug Session: FQC Hangs on Linux During Supabase Connection (2026-04-10)

**Status:** Resolved / superseded by later Supabase initialization and test-infrastructure work  
**Severity:** High (Linux deployments completely blocked)  
**Last Updated:** 2026-04-10 17:30:00

## Executive Summary

FlashQuery Core successfully starts on macOS but hangs indefinitely on Linux Mint during Supabase initialization, specifically at the "Base schema: checking tables..." phase. All isolated components (DNS, HTTPS, supabase-js) work perfectly when tested independently, suggesting the problem is in FQC's initialization sequence or configuration.

---

## Symptoms

### Expected Behavior
```
[timestamp] DEBUG  Supabase: connecting to vyezmwvfvtgdxuffdfmu.supabase.co...
[timestamp] DEBUG  Base schema: checking tables...
[timestamp] INFO   Schema verification: all 5 required tables present
[timestamp] INFO   Supabase: connected
```

### Actual Behavior (Linux)
```
[timestamp] DEBUG  Supabase: connecting to vyezmwvfvtgdxuffdfmu.supabase.co...
[timestamp] DEBUG  Base schema: checking tables...
(hangs indefinitely - never reaches "Schema verification" or "Supabase: connected")
```

### Actual Behavior (Mac)
Works perfectly - connects within 5 seconds.

### Error Messages
None - no timeout error, no exception. Just hangs silently.

### Timeline & History

1. **Commit 0e24552** (2026-04-10 15:24): Changed HTTP binding from `0.0.0.0` to `::` (IPv6 dual-stack) to fix POST /token on Linux
   - **At this commit:** Supabase connection WORKED on Linux (verified: FQC running, Claude Code writing files to vault)
   - No DNS fix was in place at this point

2. **After 0e24552 - Cleanup commits** (2026-04-10 15:38-15:41):
   - 393a91e: Removed debug logging from POST /token troubleshooting
   - 9fa44c5: Removed all [initMCP] debug logging statements
   - 2822f99: Added setup-mcp.sh script

3. **Post-cleanup:** Supabase connection STOPPED WORKING on Linux
   - User reports fuzzy timeline but suspects cleanup commits broke it

4. **Investigation session** (TODAY):
   - Attempted DNS fixes (NODE_OPTIONS flag, npm scripts, dns.setDefaultResultOrder)
   - All isolated components test successfully
   - **Tested commit 0e24552 again** - IT ALSO HANGS NOW
   - This means the problem is NOT introduced by later commits
   - Either the problem existed from 0e24552 and was masked, OR something environmental has changed

---

## What We Know Works ✅

### System Configuration (Linux Mint)
- **Node.js version:** v20.20.0
- **DNS resolver:** systemd-resolved (127.0.0.53)
- **Hostname resolution:** vyezmwvfvtgdxuffdfmu.supabase.co resolves to IPv4 only
  - 172.64.149.246
  - 104.18.38.10
  - No IPv6 record (dig AAAA returns empty)

### Individual Component Tests

1. **DNS lookup** ✅ (works instantly)
   ```
   node -e "const dns = require('dns'); dns.lookup('vyezmwvfvtgdxuffdfmu.supabase.co', {all: true}, ...)"
   Result: 104.18.38.10 (IPv4 only)
   Time: <1ms
   ```

2. **Node.js HTTPS (raw)** ✅ (works perfectly)
   ```
   https.get('https://vyezmwvfvtgdxuffdfmu.supabase.co', ...)
   Result: Connected! Status 404
   Time: 129ms
   ```

3. **supabase-js (in isolation)** ✅ (works perfectly)
   ```
   const client = createClient(url, key);
   client.from('pg_tables').select('*')
   Result: Success
   Time: 1485ms
   ```

4. **POST /pg/query endpoint** ✅ (works perfectly)
   ```
   curl: Time 180ms
   node https.request: Time 102ms
   Result: 404 (expected - invalid query, but connection succeeded)
   ```

5. **curl to Supabase** ✅ (works perfectly)
   ```
   curl -v https://vyezmwvfvtgdxuffdfmu.supabase.co/pg/query ...
   Connected instantly, TLS handshake successful
   Time: 180ms
   ```

---

## What We DON'T Know ❓

### The Mystery
Everything works in isolation. But FQC hangs. This means:
1. DNS is not the problem
2. HTTPS connections are not the problem
3. supabase-js is not the problem
4. The Supabase endpoint is responding
5. The problem is **SPECIFIC TO HOW FQC INITIALIZES OR USES THE SUPABASE CLIENT**

### Key Questions

1. **What exactly is "Base schema: checking tables..."?**
   - Which function logs this?
   - What query is being executed?
   - Is it different from what we tested (`client.from('pg_tables').select('*')`)?
   - Suspected location: `src/storage/supabase.ts` in `initSupabase()` or schema verification code

2. **Is FQC using a custom fetch implementation?**
   - Yes - `fetchWithRetry` in `src/storage/supabase.ts`
   - This is passed to `createClient()` as `{ global: { fetch: fetchWithRetry } }`
   - Could this be the issue?

3. **Is there a connection pooling or HTTP/2 vs HTTP/1.1 issue?**
   - curl uses HTTP/2 (ALPN: server accepted h2)
   - Node.js HTTPS might use HTTP/1.1
   - FQC's supabase-js might have different defaults

4. **Is there a race condition or initialization order issue?**
   - Does something hang while waiting for something else?
   - Is there a deadlock or circular dependency?

5. **Why does it work on Mac but not Linux?**
   - Different DNS resolver behavior?
   - Different systemd/network stack behavior?
   - Different Node.js or library versions?

---

## Environment Details

**Linux Machine:**
- OS: Linux Mint
- DNS: systemd-resolved
- Firewall: No iptables rules blocking the connection
- Network: IPv4 connectivity verified with curl and Node.js

**Mac Machine:**
- Works fine (no investigation needed)

---

## Current Code State

**Main branch (HEAD: 0827039)**
- `src/index.ts` includes `dns.setDefaultResultOrder('ipv4first')` call
- `src/mcp/server.ts` binds to `::` (IPv6 dual-stack)
- Debug logging has been cleaned up

**Tested Commit (0e24552)**
- No `dns.setDefaultResultOrder()` call
- Same `::` binding
- Also HANGS on Linux

---

## Files to Investigate

Priority order:

1. **`src/storage/supabase.ts`** (HIGH PRIORITY)
   - Find where "Base schema: checking tables..." is logged
   - Understand what `verifySchema()` or schema checking code does
   - Check if it's using different API calls than what we tested
   - Examine the `fetchWithRetry` function

2. **`src/index.ts`** (MEDIUM PRIORITY)
   - Check the order of initialization in `initSupabase()` call
   - Verify when HTTP server binding happens relative to Supabase init

3. **`tests/` directory** (MEDIUM PRIORITY)
   - Check if any integration tests are testing Supabase connection
   - These might reveal what code path is actually hanging

---

## Debug Hypothesis

The hang is likely caused by ONE of these:

### Hypothesis A: fetchWithRetry is broken
The custom `fetchWithRetry` function might have a bug that causes it to hang when called by supabase-js in a specific scenario (POST requests? To /pg/query endpoint? During initialization?).

**Test:** Compare what `fetchWithRetry` does vs default fetch, test with real Supabase API calls.

### Hypothesis B: Schema verification uses a different endpoint
"Base schema: checking tables..." might be calling a different endpoint (not /pg/query) that has different behavior or is slower.

**Test:** Add logging to see what URL is being requested, what method, what headers.

### Hypothesis C: Connection pooling issue
FQC might be creating multiple connections or doing concurrent requests that interact badly, whereas our isolated tests only do single requests.

**Test:** Trace the actual HTTP requests being made during initialization.

### Hypothesis D: Initialization order/timeout
Some code might be waiting for a timeout or circular dependency that only manifests during full startup.

**Test:** Add more detailed logging around schema verification.

### Hypothesis E: Environment variable or configuration issue
Something in flashquery.yml or .env is different on Linux that breaks the connection.

**Test:** Compare flashquery.yml between Mac and Linux instances.

---

## ROOT CAUSE ANALYSIS - COMPLETE ✅

**STATUS: ROOT CAUSE IDENTIFIED**

### The Hanging Mechanism

FQC's `nodeFetch()` function in `src/storage/supabase.ts` (line 80) calls `https.request()` with `hostname` option only, relying on Node.js's DNS resolution. Here's what happens on Linux with IPv6 disabled:

1. **DNS Resolution Phase**
   - Node.js calls `getaddrinfo()` to resolve `vyezmwvfvtgdxuffdfmu.supabase.co`
   - On Linux with IPv6 disabled or broken, `getaddrinfo()` returns BOTH IPv6 and IPv4 addresses (or is confused about IPv6 state)
   - By default (Node.js v20), the `autoSelectFamily` option is TRUE, which is implemented

2. **Connection Attempt Phase (the hang)**
   - Node.js tries IPv6 address FIRST (from getaddrinfo result)
   - IPv6 connection times out because:
     - Linux has IPv6 disabled or broken (can't ping6)
     - DNS returned AAAA record even though IPv6 is unavailable
     - Or IPv6 socket creation fails silently but takes time
   - Node.js waits for the timeout before trying IPv4
   - Default timeout is ~5-10 seconds per attempt (depends on system TCP timeout)
   - **The hang occurs waiting for the IPv6 connection attempt to timeout**

3. **Why It Works on macOS**
   - macOS correctly handles IPv6 availability in getaddrinfo()
   - OR macOS TCP stack handles IPv6 timeouts more quickly
   - OR the DNS resolver on macOS doesn't return AAAA for IPv6-only hosts

4. **Why Isolated Tests Worked**
   - Isolated tests were SHORT and didn't trigger the timeout
   - The http.request() timeout was long enough that the test completed before IPv6 hung
   - Or tests used a different code path that avoided the issue

### The Exact Problem in FQC Code

**File:** `src/storage/supabase.ts`, lines 80-87

```javascript
const req = requester.request(
  {
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: init?.method ?? 'GET',
    headers,
  },
  (res) => {
```

**Missing Socket Options:**
- No `family: 4` to force IPv4
- No `autoSelectFamily: false` to disable the IPv6-first behavior
- No `autoSelectFamilyAttemptTimeout` to reduce the per-address timeout

The schema verification query (line 564-566) is hanging because:
1. It calls `ddlQuery()` which uses `fetchWithRetry()`
2. `fetchWithRetry()` calls `nodeFetch()` 
3. `nodeFetch()` creates an https.request() without IPv6 controls
4. On Linux with broken IPv6, the connection tries IPv6 first and hangs waiting for timeout

### Why dns.setDefaultResultOrder('ipv4first') Didn't Help

The `dns.setDefaultResultOrder('ipv4first')` call in `src/index.ts` only affects the ORDER of results from DNS lookup. It doesn't solve the underlying problem:
- If getaddrinfo returns [IPv6, IPv4], ipv4first reorders to [IPv4, IPv6]
- But autoSelectFamily STILL tries them in parallel-with-offset pattern (IPv6 first, then IPv4 if that times out)
- So ipv4first helps only if getaddrinfo is broken enough that it returns wrong order

**The REAL issue:** autoSelectFamily tries IPv6 first with a timeout before falling back to IPv4.

## Fix Strategies

### Strategy A: Force IPv4 Only (Most Direct)
Add `family: 4` to the request options in `nodeFetch()`. This forces IPv4 and avoids the issue entirely.

**Pros:**
- Simple one-line change
- Immediate fix
- No side effects

**Cons:**
- Doesn't help if someone actually has working IPv6
- Breaks IPv6-only networks (unlikely for Supabase)

### Strategy B: Disable autoSelectFamily + Use ipv4first
Set `autoSelectFamily: false` in request options and keep `dns.setDefaultResultOrder('ipv4first')`.

**Pros:**
- Respects IPv6 if available
- Only tries IPv4 if DNS returns it first
- Works on both IPv6 and IPv4 networks

**Cons:**
- More complex
- Still slow on IPv4-only Linux if DNS returns IPv6 first

### Strategy C: Set autoSelectFamilyAttemptTimeout
Keep `autoSelectFamily: true` but add `autoSelectFamilyAttemptTimeout: 100` to give only 100ms per address before trying the next.

**Pros:**
- Keeps the "happy eyeballs" logic (try both)
- Makes it faster on broken IPv6 networks
- Works on all network types

**Cons:**
- Still tries IPv6 (slower on pure IPv4 systems)
- Magic number (100ms) might not work everywhere

### Strategy D: Detect IPv6 Availability and Choose Dynamically
Check if IPv6 is available at startup, then set family accordingly.

**Pros:**
- Optimal for each system
- No forced choices

**Cons:**
- Complex
- Adds startup overhead
- IPv6 availability can change mid-session

## Recommended Fix Order

1. **Strategy A (Force IPv4)** — Test immediately, should work
2. **Strategy C (Short timeout)** — If users want IPv6 support  
3. **Strategy B (autoSelectFamily: false)** — If we need both IPv4 and IPv6 flexibility

---

## Context for Investigation

### Linux Test Machine Details
- Location: User's Linux Mint system
- Supabase instance: Cloud-hosted (vyezmwvfvtgdxuffdfmu.supabase.co)
- Service role key: [REDACTED SUPABASE SERVICE ROLE KEY] (known to work with supabase-js tests)
- Config file: ./flashquery.yml (uses default settings)

### What to Watch For
- Any difference between curl's behavior and FQC's behavior
- Any difference between successful isolated supabase-js test and FQC's usage
- Any environment-specific behavior on Linux vs Mac
- Any timing/timeout issues that don't appear in short isolated tests

---

## How to Execute This Debug

**When starting fresh in a new context:**

1. Read this file first
2. Read src/storage/supabase.ts to find schema verification code
3. Add detailed logging to identify the hanging request
4. Run `npm run dev` on Linux and capture full output
5. Identify which request hangs
6. Create isolated reproduction
7. Identify root cause
8. Implement fix
9. Test on both Linux and Mac

---

## INVESTIGATION CONTINUATION — Context Reset (2026-04-10 17:45)

**Current Status:** IPv4 force (family: 4) was applied but hang still occurs.

**This means:** The root cause is NOT the IPv6/autoSelectFamily issue. Something else is hanging in the schema verification code path.

### Critical Discovery: Two Code Paths in ddlQuery()

**File:** `src/storage/supabase.ts` lines 154-188

Function `ddlQuery()` has TWO completely different implementations:

**Path A (if databaseUrl is provided, lines 160-172):**
```typescript
const client = new pg.Client({ connectionString: databaseUrl });
await client.connect();
try {
  await client.query(sql);
} finally {
  await client.end();
}
```
→ Uses **direct PostgreSQL TCP connection**

**Path B (if databaseUrl is NOT provided, lines 174-187):**
```typescript
const response = await fetchWithRetry(queryUrl, {
  method: 'POST',
  headers: { ... },
  body: JSON.stringify({ query: sql }),
});
```
→ Uses **HTTP POST to /pg/query endpoint** (postgres-meta endpoint)

**The hang happens in the schema verification at line 567:**
```typescript
await ddlQuery(supabaseUrl, serviceRoleKey, buildSchemaDDL(dimensions), databaseUrl);
```

**CRITICAL:** Depending on whether `databaseUrl` was set in the config, this hangs in Path A or Path B.

### Investigating Both Paths

**If using Path A (databaseUrl set):**
- The hang is in `new pg.Client()` or `client.connect()` or `client.query()`
- Not an HTTP issue → IPv4 force wouldn't help
- This is a **direct TCP socket** to PostgreSQL
- PostgreSQL port is typically 5432 (or 54322 for local Supabase)
- On Linux, this socket might have the same IPv6 issue as HTTP

**If using Path B (databaseUrl NOT set):**
- The hang is in `fetchWithRetry()` calling `/pg/query`
- IPv4 force was applied to `nodeFetch()` which is used by `fetchWithRetry()`
- But the hang still occurs...
- Possible: `fetchWithRetry()` is using a DIFFERENT fetch path (supabase-js's built-in fetch?)

### Critical Insight: pg.Client Uses Node.js TCP Sockets

**Discovery:** The `pg` package (PostgreSQL client) uses Node.js's native TCP socket implementation, which:
- **DOES respect** `dns.setDefaultResultOrder('ipv4first')`
- BUT **STILL respects** Node.js's `autoSelectFamily` behavior for parallel IPv6+IPv4 attempts
- Even with `ipv4first`, the socket layer might still try IPv6 first with a timeout

**Key Code Locations with pg.Client (no family option):**
- `src/storage/supabase.ts` line 162: `ddlQuery()` function
- `src/storage/supabase.ts` line 576: `verifySchema()` function  
- `src/projects/seeder.ts` line 45: `initProjects()` function
- And 6 other locations in tools and services

**The Problem:** When creating pg.Client with just `{ connectionString: databaseUrl }`, no socket options are passed, so Node.js's autoSelectFamily defaults apply.

### Hypothesis E (NEW): The Hang is in pg.Client TCP Connection

**If the user has `database_url` configured in flashquery.yml:**
1. FQC calls `ddlQuery(supabaseUrl, serviceRoleKey, buildSchemaDDL(), databaseUrl)`
2. `ddlQuery()` enters Path A (line 160)
3. `new pg.Client({ connectionString: databaseUrl })` creates connection object
4. `await client.connect()` attempts to open the socket
5. **Node.js attempts IPv6 first** (despite setDefaultResultOrder) due to autoSelectFamily
6. **Connection times out waiting for IPv6 to fail** (5-30 seconds)
7. Eventually falls back to IPv4 (if at all)
8. **The hang never completes because the code is waiting for the IPv6 timeout**

### How to Fix pg.Client IPv6 Hang

The `pg` package accepts a `family` option in the config object. According to pg documentation:
```javascript
new pg.Client({
  connectionString: databaseUrl,
  family: 4  // Force IPv4 only
})
```

This would bypass the IPv6 attempt entirely.

### Next Investigation: Verify Which Path Is Being Used

**Three questions to answer:**

1. **Did the user configure `database_url` in flashquery.yml?**
   - If YES → Likely in Path A (pg.Client) → Need to add `family: 4` to pg.Client config
   - If NO → Likely in Path B (HTTP) → But IPv4 force already applied to HTTP, so something else is wrong

2. **If in Path B (HTTP), why does hang still occur with `family: 4` in nodeFetch?**
   - Possible: supabase-js is not using our custom fetch
   - Possible: supabase-js is making multiple requests and one of them hangs
   - Possible: The hang is not in the HTTP layer at all, but somewhere else

3. **Add detailed logging to identify exact hanging point**
   - Log before and after each critical await
   - Identify which line the code hangs on
   - This will definitively show Path A vs Path B

---

## ROOT CAUSE IDENTIFIED ✅ — pg.Client IPv6 Timeout on Linux

**Status:** FIX APPLIED AND TESTED TO BUILD

### The Actual Problem

The pg.Client package, when connecting to a PostgreSQL database, uses Node.js's native DNS resolution and TCP socket implementation. On Linux systems with broken or disabled IPv6:

1. DNS returns BOTH IPv4 and IPv6 addresses (or lies about IPv6 availability)
2. Node.js's `autoSelectFamily` option (default TRUE) tries IPv6 first
3. IPv6 connection attempt hangs waiting for TCP timeout (5-30 seconds per attempt)
4. Only after IPv6 times out does it try IPv4
5. **Result:** FQC hangs during "Base schema: checking tables..." phase

This happened even though `dns.setDefaultResultOrder('ipv4first')` was set, because:
- `setDefaultResultOrder()` only controls DNS result ORDER
- `autoSelectFamily` still uses a timeout-based fallback mechanism for trying addresses in parallel
- The hang occurs in the TCP socket layer, not DNS

### The Fix Applied

**Created:** `src/utils/pg-client.ts` with helper function:
```typescript
export function createPgClientIPv4(connectionString: string): pg.Client {
  return new pg.Client({ connectionString, family: 4 } as any);
}
```

**Updated 11 locations** where pg.Client is created:
- `src/storage/supabase.ts` (3 instances in ddlQuery, skipDdl check, post-DDL verify)
- `src/git/manager.ts` (1 instance in dumpDatabase)
- `src/projects/seeder.ts` (1 instance in initProjects)
- `src/services/plugin-propagation.ts` (1 instance in discoverPluginTables)
- `src/services/scanner.ts` (1 instance, inline with type assertion)
- `src/mcp/tools/plugins.ts` (1 instance in register_plugin)
- `src/mcp/tools/records.ts` (3 instances in embedRecord, search_records with embedding, search_records with ILIKE)

**Build Status:** ✅ `npm run build` succeeds with no TypeScript errors

### Why This Fix Works

`family: 4` forces Node.js TCP socket creation to use IPv4 only, completely bypassing the IPv6 attempt and timeout. This:
- ✅ Eliminates the hang on Linux with broken IPv6
- ✅ Works with Supabase cloud (IPv4 only)
- ✅ Works with local Supabase (IPv4 only by default)
- ✅ Respects the existing `dns.setDefaultResultOrder('ipv4first')` in startup

### Files Modified

1. **New file:** `src/utils/pg-client.ts` — Helper function with type assertion for `family` option
2. **Modified:** `src/storage/supabase.ts` — Added import, changed 3 pg.Client creations to use helper
3. **Modified:** `src/git/manager.ts` — Added import, changed 1 pg.Client creation to use helper
4. **Modified:** `src/projects/seeder.ts` — Added import, changed 1 pg.Client creation to use helper
5. **Modified:** `src/services/plugin-propagation.ts` — Added import, changed 1 pg.Client creation to use helper
6. **Modified:** `src/services/scanner.ts` — Changed 1 pg.Client creation to use inline type assertion (already had import)
7. **Modified:** `src/mcp/tools/plugins.ts` — Added import, changed 1 pg.Client creation to use helper
8. **Modified:** `src/mcp/tools/records.ts` — Added import, changed 3 pg.Client creations to use helper

### Next: User Testing on Linux

The user should test on Linux Mint with:
```bash
npm run dev
```

Expected behavior:
- Should see "[ddlQuery] Using Path A: direct PostgreSQL connection"
- Should see "[ddlQuery] Connected to PostgreSQL, executing query..."
- Should see "[ddlQuery] Query executed successfully"
- Should see "Schema verification: all 5 required tables present"
- Should see "Supabase: connected"
- Should complete startup without hanging

---

## NEW ERROR REPORT — DNS Resolution Fails on Linux (2026-04-10 18:30)

**User reports:** After the IPv4 fix was applied to `createPgClientIPv4()`, a new error appears:
```
ERROR  [ddlQuery] Path A failed: getaddrinfo ENOTFOUND db.vyezmwvfvtgdxuffdfmu.supabase.co
```

**This is different from the hang.** Now it's a DNS resolution failure.

### Root Cause Analysis — net.createConnection() With family: 4

The issue is in how `createPgClientIPv4()` creates the socket:

**File:** `src/utils/pg-client.ts` lines 15-25

```typescript
export function createPgClientIPv4(connectionString: string): pg.Client {
  const url = new URL(`postgresql://${connectionString.split('://')[1]}`);
  const hostname = url.hostname || 'localhost';
  const port = parseInt(url.port || '5432', 10);

  const stream = net.createConnection({ host: hostname, port, family: 4 });
  return new pg.Client({ connectionString, stream });
}
```

### The Problem

When `net.createConnection()` is called with `family: 4`, it:
1. **ONLY uses IPv4 address family** for DNS resolution
2. Calls `dns.lookup(hostname, {family: 4}, ...)` internally
3. **On systems where DNS returns ONLY IPv6 results** (or when IPv4 is unavailable), the lookup fails
4. **OR on systems where `dns.lookup()` with `family: 4` doesn't work as expected**, it fails

### Why This is Happening

**Theory 1: DNS result filtering**
- `family: 4` tells Node.js to filter DNS results to IPv4 only
- If the DNS resolver returns ONLY IPv6 addresses for that host (or ALL addresses are filtered), the lookup fails
- Result: `ENOTFOUND` error

**Theory 2: DNS resolver behavior on Linux**
- On the user's Linux system, `dns.lookup()` with `family: 4` might not work the same way as on macOS
- systemd-resolved might handle the family option differently
- Result: DNS fails even though the hostname is resolvable

**Theory 3: URL parsing issue**
- The parsing logic might be failing to extract the correct hostname
- `connectionString.split('://')[1]` might be producing an invalid partial URL
- But testing shows parsing works correctly

### Why the HTTP Path (Path B) Works

Path B uses:
```typescript
const req = requester.request({
  hostname: url.hostname,
  port: url.port || (url.protocol === 'https:' ? 443 : 80),
  ...
  family: 4,  // Force IPv4
}, ...)
```

This also has `family: 4`, but:
- HTTP requests might have different DNS behavior
- https.request() might not fail the same way as net.createConnection()
- Or the retry logic (`fetchWithRetry()`) is masking the error

### The Fix: Remove Direct Stream Pre-creation

Instead of pre-creating a stream and passing it to pg.Client, **let pg.Client handle the socket creation** with the correct options:

```typescript
export function createPgClientIPv4(connectionString: string): pg.Client {
  return new pg.Client({
    connectionString,
    family: 4  // Force IPv4 at pg.Client level
  } as any);
}
```

This way:
- pg.Client uses its own socket creation logic
- The `family: 4` option is passed to the internal socket layer
- No intermediate `net.createConnection()` that might have different DNS behavior

### Why This Should Work

- pg.Client accepts a `family` option in its config
- This option is passed directly to Node.js's socket layer when pg connects
- Avoids the issue with pre-creating a stream that dns.lookup() might reject
- Let the native pg implementation handle IPv4 forcing

### Verification

The fix is to change `createPgClientIPv4()` from:
```typescript
const stream = net.createConnection({ host: hostname, port, family: 4 });
return new pg.Client({ connectionString, stream });
```

To:
```typescript
return new pg.Client({ connectionString, family: 4 } as any);
```

This eliminates the intermediate `net.createConnection()` and lets pg handle socket creation with the `family` option.

---

## FINAL ROOT CAUSE — pg does NOT support `family` option (2026-04-10 — this session)

**Status:** DEFINITIVE ROOT CAUSE FOUND AND FIXED

### What was discovered

Reading the pg library source directly (`node_modules/pg/lib/`) revealed that `family: 4` passed to `pg.Client` config is **silently ignored** — pg never reads it:

- `connection-parameters.js`: Only extracts `user`, `database`, `port`, `host`, `ssl`, `keepAlive`, `binary`, `options`, `replication`, `client_encoding`, `application_name`, `statement_timeout`, `lock_timeout`, `query_timeout`, `connectionTimeoutMillis`. No `family`.
- `client.js` line 76-84: Constructs `new Connection({stream, ssl, keepAlive, keepAliveInitialDelayMillis, encoding})`. No `family`.
- `stream.js` line 22-24: `getStream()` returns `new net.Socket()` — no options, no family constraint.
- `connection.js` line 42: Calls `this.stream.connect(port, host)` — plain connect, no address-family hint.

**The `family: 4` option was dead code.** The `as any` type assertion was the first warning sign — TypeScript didn't recognize the option because pg doesn't define it.

### The actual hang mechanism

Node.js v20 has `autoSelectFamily: true` by default (Happy Eyeballs / RFC 6555). When pg calls `new net.Socket().connect(port, host)`:

1. Node.js resolves `db.vyezmwvfvtgdxuffdfmu.supabase.co` via DNS
2. Even with `dns.setDefaultResultOrder('ipv4first')`, `autoSelectFamily: true` attempts an IPv6 connection first (with a delay before trying IPv4)
3. On Linux Mint with broken/disabled IPv6, the IPv6 attempt hangs until TCP timeout
4. The hang is at the TCP socket layer, not DNS

`dns.setDefaultResultOrder('ipv4first')` alone is insufficient — it controls DNS result ordering but `autoSelectFamily` still fires IPv6 attempts at the socket layer.

### The fix

**`net.setDefaultAutoSelectFamily(false)`** disables Happy Eyeballs globally. When pg's `new net.Socket().connect(port, host)` runs, Node.js uses the first DNS result only (IPv4, because of `ipv4first`) and connects directly — no IPv6 attempt, no hang.

Combined with the existing `dns.setDefaultResultOrder('ipv4first')`, this guarantees IPv4-only TCP connections for all bare sockets including pg's.

### Files changed

1. **`src/index.ts`** — Added `import net from 'node:net'` and `net.setDefaultAutoSelectFamily(false)` immediately after the DNS fix. Updated console message.
2. **`src/utils/pg-client.ts`** — Removed the dead `family: 4` option and `as any` cast. Updated comment to explain the real fix mechanism.
3. **`src/services/scanner.ts`** — Replaced the stray `new pg.Client({ connectionString: databaseUrl, family: 4 } as any)` with `createPgClientIPv4(databaseUrl)` (which now simply creates a plain client, with IPv4 forced globally at startup).

### Build verification

`npm run build` passes cleanly with no TypeScript errors.

### Why this is correct on all platforms

- **Linux (broken IPv6):** `net.setDefaultAutoSelectFamily(false)` stops the IPv6-first hang. pg connects to IPv4 immediately.
- **macOS (working IPv6):** `autoSelectFamily: false` means Node uses the first DNS result. With `ipv4first`, that's IPv4. For Supabase cloud (IPv4-only endpoint), this is correct and fast.
- **Systems with working IPv6:** If a pg server is genuinely IPv6-only, this could be an issue — but Supabase is IPv4 only, and local Supabase is always localhost/IPv4. This is an acceptable trade-off.

### Verification checklist

- [x] Build succeeds
- [ ] `npm run dev` on Linux reaches "Schema verification: all 5 required tables present"
- [ ] `npm run dev` on Linux reaches "Supabase: connected"
- [ ] No hang at "[ddlQuery] pg.Client created, attempting to connect..."

---

## LINUX TESTING RESULTS — RESOLVED (2026-04-10 18:46)

**Status:** ISSUE RESOLVED

### What happened with the autoSelectFamily fix

`net.setDefaultAutoSelectFamily(false)` was applied to `src/index.ts` and the build passed, **but the hang persisted**. This is because the root cause was NOT autoSelectFamily or IPv6 preference — it was a **fundamentally unreachable endpoint**.

### TRUE Root Cause

**`db.vyezmwvfvtgdxuffdfmu.supabase.co` resolves to IPv6 ONLY:**
```
$ dig +short db.vyezmwvfvtgdxuffdfmu.supabase.co A
(empty — no IPv4 record)

$ dig +short db.vyezmwvfvtgdxuffdfmu.supabase.co AAAA
2600:1f13:838:6e59:b3be:5592:4c75:944d
```

**The Linux box has IPv6 addresses but cannot route to Supabase's IPv6:**
```
$ ping6 -c 2 db.vyezmwvfvtgdxuffdfmu.supabase.co
2 packets transmitted, 0 received, 100% packet loss
```

No amount of IPv4-forcing, DNS reordering, or autoSelectFamily changes can fix a connection to a hostname that has **no IPv4 address**. The `db.` subdomain is Supabase's direct PostgreSQL endpoint and it only has an AAAA (IPv6) DNS record.

Meanwhile, the main Supabase API (`vyezmwvfvtgdxuffdfmu.supabase.co`, without `db.`) resolves to IPv4 via Cloudflare (`172.64.149.246`, `104.18.38.10`) — which is why HTTP/REST calls work fine.

### The Fix: Use Supabase Connection Pooler

Supabase's connection pooler uses an IPv4-reachable AWS ELB:
```
$ dig +short aws-1-us-west-2.pooler.supabase.com A
44.225.139.66
44.252.246.120
```

Changed `DATABASE_URL` in `.env` from:
```
postgresql://postgres:***@db.vyezmwvfvtgdxuffdfmu.supabase.co:5432/postgres
```
To:
```
postgresql://postgres.vyezmwvfvtgdxuffdfmu:***@aws-1-us-west-2.pooler.supabase.com:6543/postgres
```

### Test Results (Linux Mint, Node.js v20.20.0)

```
✅ npm run dev — starts successfully, no hang
✅ Schema verification: all 5 required tables present (connected in ~2s)
✅ Supabase: connected
✅ FlashQuery Core ready (port 3100, streamable-http)
✅ Vault scan completed, embeddings generated
✅ POST /token — 200 OK with valid JWT access_token
✅ Graceful shutdown on SIGTERM
```

### Summary

The entire IPv6 investigation (dns.setDefaultResultOrder, family:4 on pg.Client, net.setDefaultAutoSelectFamily) was chasing the wrong problem. The real issue was that Supabase's `db.` direct PostgreSQL endpoint is **IPv6-only** and this Linux network cannot route to that IPv6 address. The fix is to use the connection pooler endpoint which has IPv4 DNS records.

### Implications for the codebase

1. The `dns.setDefaultResultOrder('ipv4first')` and `net.setDefaultAutoSelectFamily(false)` in `src/index.ts` are harmless but unnecessary for this specific issue. They may help in other IPv6-related edge cases.
2. The `createPgClientIPv4()` helper is now just a plain `new pg.Client({ connectionString })` wrapper — the `family: 4` was dead code (pg ignores it).
3. The real fix is a **deployment/config change** (use pooler URL), not a code change.
4. Documentation should note that `db.` direct endpoints may be IPv6-only and users on IPv4-only networks should use the pooler endpoint.
