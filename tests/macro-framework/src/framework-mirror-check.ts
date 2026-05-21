// Framework-vs-production drift tripwire.
//
// `framework-registry.ts wrapBrokerToolForFramework` is a hand-written
// mirror of production's `src/macro/registry.ts wrapBrokerTool`. The
// framework can't import the production function directly because it's
// module-private, so the mirror is the only practical option — but it
// invites silent drift if production changes.
//
// This module is a cheap tripwire. At test startup we:
//   1. Hash the entire `src/macro/registry.ts` file.
//   2. Extract just the `wrapBrokerTool` function body and hash THAT.
//
// Both hashes are compared against pinned values below. If either
// differs, the test suite fails fast with a clear message telling the
// maintainer:
//   - WHAT changed (file vs function-body).
//   - WHERE to look (registry.ts:142 onward).
//   - WHAT to do (review the change, update the mirror if behavior
//     drifted, then re-pin the hash).
//
// When you intentionally update production's wrapBrokerTool:
//   1. Mirror the change in `framework-registry.ts wrapBrokerToolForFramework`.
//   2. Run the suite once to see the new hashes in the failure message.
//   3. Paste both new hashes into the constants below.
//   4. Re-run; suite should pass.
//
// File-level + function-body hashes are deliberately redundant. The
// file-level hash trips on ANY change (including comments / imports),
// surfacing changes the maintainer should at least glance at. The
// function-body hash trips only on behavior-relevant changes inside
// wrapBrokerTool, distinguishing "behavior changed" from "cosmetic
// edit nearby."

import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const FRAMEWORK_DIR = dirname(fileURLToPath(import.meta.url));
const REGISTRY_PATH = join(FRAMEWORK_DIR, '..', '..', '..', 'src', 'macro', 'registry.ts');

// Pinned hashes. Update these when you intentionally change production
// or the framework mirror. The failure message at test time prints the
// current values so you can copy-paste them.
const PINNED_FILE_HASH = '348450d8071721574abec855190adb798b355cd912f7d51e67b93db1c690a4f8';
const PINNED_FUNCTION_HASH = '1fb49fca99fa2aa828f15e033f09a9630075d399647aca7720e9be8b3b59a65c';

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

/**
 * Extracts the body of `function wrapBrokerTool(...)` from registry.ts.
 * Brace-balanced scan from the function signature; resilient to
 * formatting changes but assumes the function is defined with the
 * `function wrapBrokerTool(input: {` opening line shape.
 *
 * Returns null if the signature can't be located — caller should treat
 * that as a hard failure (production refactored the function out of
 * the recognized shape; mirror almost certainly needs updating).
 */
function extractWrapBrokerToolBody(source: string): string | null {
  const sigIdx = source.indexOf('function wrapBrokerTool(');
  if (sigIdx === -1) return null;
  // Find the opening brace of the function body. Scan forward from
  // the signature; the first `{` after a matching `)` is the body.
  let depth = 0;
  let i = sigIdx;
  let openParenIdx = -1;
  for (; i < source.length; i++) {
    const c = source[i];
    if (c === '(') {
      if (openParenIdx === -1) openParenIdx = i;
      depth++;
    } else if (c === ')') {
      depth--;
      if (depth === 0 && openParenIdx !== -1) {
        // Skip return-type annotation (`: ToolFn`) before the body brace.
        // Look for the next `{` that isn't part of a destructure / type.
        let j = i + 1;
        while (j < source.length && source[j] !== '{') j++;
        if (j >= source.length) return null;
        // Brace-balanced scan for the body close.
        let bodyDepth = 0;
        for (let k = j; k < source.length; k++) {
          const ck = source[k];
          if (ck === '{') bodyDepth++;
          else if (ck === '}') {
            bodyDepth--;
            if (bodyDepth === 0) {
              return source.slice(j, k + 1);
            }
          }
        }
        return null;
      }
    }
  }
  return null;
}

export interface MirrorCheckResult {
  ok: boolean;
  fileHash: string;
  functionHash: string | null;
  message: string;
}

export async function checkFrameworkMirror(): Promise<MirrorCheckResult> {
  const source = await readFile(REGISTRY_PATH, 'utf8');
  const fileHash = sha256(source);
  const body = extractWrapBrokerToolBody(source);
  const functionHash = body !== null ? sha256(body) : null;

  if (functionHash === null) {
    return {
      ok: false,
      fileHash,
      functionHash: null,
      message:
        `framework-mirror-check: could NOT locate the \`function wrapBrokerTool(\` ` +
        `definition in ${REGISTRY_PATH}. Production likely refactored the function ` +
        `shape (renamed, converted to an arrow function, moved to another module). ` +
        `Investigate and update the framework mirror in tests/macro-framework/` +
        `framework-registry.ts wrapBrokerToolForFramework + the extractor logic ` +
        `in framework-mirror-check.ts.`,
    };
  }

  const fileOk = fileHash === PINNED_FILE_HASH;
  const fnOk = functionHash === PINNED_FUNCTION_HASH;
  if (fileOk && fnOk) {
    return { ok: true, fileHash, functionHash, message: 'mirror in sync' };
  }

  const parts: string[] = [
    'framework-mirror-check: production registry.ts has drifted from the framework mirror.',
    '',
    `  File hash:     ${fileHash} (pinned: ${PINNED_FILE_HASH}) ${fileOk ? 'OK' : 'CHANGED'}`,
    `  Function hash: ${functionHash} (pinned: ${PINNED_FUNCTION_HASH}) ${fnOk ? 'OK' : 'CHANGED'}`,
    '',
  ];
  if (!fnOk) {
    parts.push(
      '  The wrapBrokerTool function body changed. The framework mirror at',
      '  tests/macro-framework/framework-registry.ts wrapBrokerToolForFramework',
      '  is now potentially stale. Review the production diff at',
      '  src/macro/registry.ts:142 onward, update the mirror to match, then',
      '  paste the new hashes into framework-mirror-check.ts.',
    );
  } else {
    parts.push(
      '  Only the file content outside wrapBrokerTool changed (likely imports,',
      '  helpers, or another function). The mirror itself is probably still',
      '  accurate. Update PINNED_FILE_HASH after confirming.',
    );
  }
  return {
    ok: false,
    fileHash,
    functionHash,
    message: parts.join('\n'),
  };
}
