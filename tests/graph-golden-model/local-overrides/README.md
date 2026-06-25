# local-overrides/

Local overrides of production source files, under the **production-first / local-override** policy
(see `../README.md` §3.7 and `../PORT_BACK.md` §5.1).

**Rule:** the workbench uses the REAL production source by default. A file appears here ONLY because
testing required a change to that production file. The override is staged for the one-shot push and
is **removed after the change lands in production**.

**Layout:** mirror the production path exactly so the mapping is unambiguous — e.g.
`local-overrides/src/graph/schemas.ts` overrides the repo's `src/graph/schemas.ts`. Override files
**re-export the same symbol names as production** so they are drop-in.

**When you must change a production TS file (a diagnosed logic/schema bug):**
1. Copy it to the mirrored path under `local-overrides/`, keeping the production export names.
2. Make the minimal change; mark deltas with a `PROPOSED` comment.
3. Point the relevant workbench import at the override.
4. Add a row to `PORT_BACK.md` (§1 deltas + §1.5 file map).

**Currently active overrides:**
- `src/graph/schemas.ts` — node payload schema (optional `reasoning`, relaxed `analyzed_content_hash`).

When there is more than one override (or you want to switch prod/local without editing imports),
add the generic `resolveGraphSource()` resolver described in `PORT_BACK.md` §5.1.
