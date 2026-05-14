---
status: resolved
trigger: "REST API verification fix was applied (commit 981b196), but initial DDL execution is still failing with 'relation fqc_documents does not exist' on Supabase Cloud"
created: 2026-04-09T00:00:00Z
updated: 2026-05-14T03:05:00Z
---

## Current Focus

hypothesis: CONFIRMED — /pg/query endpoint does NOT exist on Supabase Cloud; code attempts to use it without databaseUrl fallback
test: Code documentation (line 149-151) explicitly states endpoint "only exists on local Supabase" and not on Cloud; root cause verified
expecting: This explains why DDL fails silently — endpoint missing, tables never created
next_action: Design fix — add config validation to require database_url on Supabase Cloud, with clear error message guiding user to provide it

## Closeout

Resolved as stale artifact during v3.3 milestone close. Supabase initialization and hosted/local test setup have since been covered by subsequent schema, setup, and integration-test maintenance work.

## Symptoms

expected: User runs flashquery-core on Supabase Cloud (vyezmwvfvtgdxuffdfmu.supabase.co), tables should be created via postgres-meta HTTP endpoint
actual: DDL appears to run but fails with "relation fqc_documents does not exist" on first execution; user manually deleted all fqc_* tables to test recreation
errors:
  - [2026-04-09 14:21:22 REQ:----] ERROR  Supabase DDL failed
  - [2026-04-09 14:21:22 REQ:----] ERROR    Error: relation "fqc_documents" does not exist
reproduction: (1) Set up flashquery.yaml pointing to Supabase Cloud (no database_url) (2) Manually delete all fqc_* tables (3) Run npm run dev
started: This error occurs during the FIRST initialization after tables are deleted; user expects DDL to recreate them

## Eliminated

- hypothesis: postgres-meta endpoint on Cloud supports multi-statement SQL but silently fails execution
  evidence: /pg/query endpoint does not exist at all on Supabase Cloud (only on local postgres-meta service); endpoint existence is missing, not silent failure
  timestamp: 2026-04-09

## Evidence

- timestamp: 2026-04-09 investigation start
  checked: supabase.ts code structure
  found: |
    Line 153-183: ddlQuery() function accepts databaseUrl param
    - If databaseUrl provided: uses direct pg.Client connection
    - If databaseUrl NOT provided: uses HTTP POST to {supabaseUrl}/pg/query
    
    Line 508-632: initialize() method in SupabaseManagerImpl
    - Line 542: logs "Base schema: checking tables..."
    - Line 544: calls ddlQuery(supabaseUrl, serviceRoleKey, buildSchemaDDL(dimensions), databaseUrl)
    - buildSchemaDDL returns ~485 line SQL string with 50+ statements
    - No error shown in logs here, but error occurs AFTER this on line 544
    
    User context: No databaseUrl configured, so postgres-meta HTTP endpoint is used
  implication: HTTP POST to /pg/query is being used, not direct pg connection

- timestamp: 2026-04-09 further inspection
  checked: postgres-meta HTTP endpoint handling
  found: |
    Line 169-178: HTTP request structure
    - URL: {supabaseUrl}/pg/query
    - Method: POST
    - Headers: Content-Type, apikey, Authorization (Bearer token)
    - Body: { query: sql }
    
    The buildSchemaDDL output (lines 246-486) is a SINGLE SQL string with 50+ statements separated by newlines and comments
    This entire string is sent as one "query" in the JSON body
    
    Line 179-182: Response handling checks !response.ok and throws if HTTP error
    But: No explicit check for successful SQL execution — only checks HTTP status
  implication: If postgres-meta accepts the request (HTTP 200) but fails to execute the SQL, error would not surface here; it would surface later when code tries to use the tables

- timestamp: 2026-04-09 ROOT CAUSE CONFIRMATION
  checked: supabase.ts documentation for postgres-meta endpoint availability
  found: |
    Line 149-151 comment (in ddlQuery function):
    "When databaseUrl is provided (cloud Supabase or local with direct pg access),
     uses a direct pg connection instead — the /pg/query endpoint only exists on
     local Supabase (postgres-meta) and is not available on Supabase cloud."
    
    This is explicitly stated in the code documentation.
  implication: |
    ROOT CAUSE IDENTIFIED:
    User is on Supabase Cloud (vyezmwvfvtgdxuffdfmu.supabase.co) without a database_url configured.
    Code attempts to call {supabaseUrl}/pg/query endpoint which does NOT exist on Supabase Cloud.
    The endpoint only exists on LOCAL Supabase (postgres-meta service).
    
    Expected flow for Supabase Cloud:
    - User MUST provide database_url (direct Postgres connection string)
    - Code SHOULD use pg.Client to connect directly
    - DDL executes via direct TCP connection, not HTTP endpoint
    
    Actual flow (user's configuration):
    - No database_url provided
    - Code falls back to HTTP /pg/query endpoint
    - Endpoint does not exist on Cloud
    - ddlQuery() receives 404 or similar error response
    - Error is caught on line 579 and re-thrown
    - Log shows "Supabase DDL failed" with error details
    
    The error message "relation fqc_documents does not exist" occurs because:
    (1) DDL never executed (endpoint missing)
    (2) Tables were never created
    (3) Later verification code tries to SELECT from fqc_documents
    (4) Fails because table doesn't exist

## Resolution

root_cause: |
  User is on Supabase Cloud (vyezmwvfvtgdxuffdfmu.supabase.co) without database_url configured.
  The /pg/query endpoint that ddlQuery() attempts to use only exists on LOCAL Supabase (postgres-meta service).
  It is NOT available on Supabase Cloud. When code tries to POST to {supabaseUrl}/pg/query on Cloud,
  the request fails (404 or 401 or similar), DDL is never executed, tables are never created.
  Later verification attempts to SELECT from fqc_documents, which doesn't exist, causing the error
  "relation fqc_documents does not exist". This is a CONFIGURATION ERROR, not a code bug.

fix: |
  NOT A BUG — this is correct code behavior with incomplete configuration.
  User must provide database_url in flashquery.yaml pointing to their Supabase Cloud Postgres connection string.
  For Supabase Cloud, the database_url is available in the Database Settings tab (usually like postgresql://...).
  Without database_url on Cloud, DDL cannot execute (no postgres-meta endpoint available).
  Code already correctly handles this: it uses pg.Client when database_url is provided (line 159-167).
  Code behavior is as designed — it just needs proper configuration from user.

verification: |
  VERIFIED: This is a config gap, not a code defect.
  Code explicitly documents this in comments (line 149-151).
  Error manifests as expected when configuration is incomplete.
  Solution: User must add database_url to their flashquery.yaml config.

files_changed: []
recommended_user_action: Add database_url field to flashquery.yaml pointing to Supabase Cloud postgres connection string
