# Macro POC Fixture Migration

This directory preserves the 17 macro-prototype examples as production v0
fixtures. The unit suite executes every `.fqm` file through `runMacroSource`
with deterministic native and broker tool stubs.

Migration notes:

- Files use production `fq.*` and brokered `server.tool` calls instead of
  prototype-only shorthands.
- `07-cancellation.fqm` keeps the cancellation workflow shape but uses 1 ms
  `slow_op` durations so the fixture suite stays fast.
- `sample-vault/` contains local read-only data for shell verb examples and the
  vault-jail escape rejection case.
