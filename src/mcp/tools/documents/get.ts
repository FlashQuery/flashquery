import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { supabaseManager } from '../../../storage/supabase.js';
import { embeddingProvider } from '../../../embedding/provider.js';
import { logger } from '../../../logging/logger.js';
import { getIsShuttingDown } from '../../../server/shutdown-state.js';
import { jsonExpectedError, jsonRuntimeError, jsonToolResult, type ErrorEnvelope } from '../../utils/response-formats.js';
import { validateParameterCombinations, resolveAndBuildDocument, DocumentRequestError } from '../../utils/document-output.js';
import type { DocumentToolDeps } from './deps.js';
import { scheduleDocumentEmbedding } from './helpers.js';

export function registerGetDocumentTool(server: McpServer, deps: DocumentToolDeps): void {
  const { config } = deps;
  server.registerTool(
      'get_document',
      {
        description:
          'Read one or more documents and return a structured JSON envelope. The envelope always contains identifier, title, path, fq_id, modified, and size.chars. Identifiers may be a single string or an array (string[]) for batch retrieval; array input returns an array response with per-element success or error objects (the call itself never fails for partial errors). Use the include parameter to also receive: "body" (full markdown body or extracted sections), "frontmatter" (complete YAML block as JSON object — every field, including user-defined custom fields), or "headings" (heading list with per-heading character counts). Default include is ["body"]. Use sections to extract specific sections by heading name (case-insensitive substring; queries starting with a digit are anchored to the heading start, so "3" matches "3. Scope" but not "13. Conversations"). Multi-element sections returns sections in input order separated by a blank line; repeating a name N times returns the 1st through Nth matches. Use max_depth (1-6) to limit heading levels in the headings list. Use follow_ref (a dot-separated path into the source document\'s frontmatter, e.g. "supersedes" or "projections.summary") to dereference a frontmatter pointer; the target document\'s content is returned nested under "followed_ref" and all body/frontmatter/headings/sections options apply to the target. The output is a JSON string in content[0].text.',
        inputSchema: {
          identifiers: z.union([z.string(), z.array(z.string())]).describe(
            'Document identifier(s). Single string or array for batch retrieval. ' +
            'Each element may be a vault-relative path, fq_id UUID, or filename. ' +
            'Array input always returns an array response with per-element success or error objects (the MCP call never fails on partial errors). ' +
            'String input returns a flat object response (backward compatible with Phase 107).'
          ),
          include: z.array(z.enum(['body', 'frontmatter', 'headings']))
            .optional()
            .default(['body'])
            .describe('Which fields to include in the response. Any combination of "body", "frontmatter", "headings". Default: ["body"].'),
          sections: z.array(z.string()).optional().describe(
            'Optional: heading names to extract (case-insensitive substring). Requires "body" in include. Multi-element returns sections in input order separated by blank lines; repeating a name N times returns the 1st through Nth matches.'
          ),
          include_nested: z.boolean().optional().default(true).describe(
            'When extracting sections, include nested subsection content (default: true). When false, stop at the first subheading.'
          ),
          occurrence: z.number().optional().default(1).describe(
            'Which occurrence of a heading when name appears multiple times (1-indexed, default: 1). Valid only when sections has exactly one element.'
          ),
          max_depth: z.number().optional().default(6).describe(
            'Maximum heading depth to include when include contains "headings" (1-6, default: 6 — all levels).'
          ),
          follow_ref: z.string().min(1).optional().describe(
            'Optional dot-separated path into the source document\'s frontmatter (e.g., "supersedes" or "projections.summary"). ' +
            'The string value at that path is resolved as a document identifier; the target document\'s content is returned ' +
            'nested under "followed_ref" in the response. When used, body/frontmatter/headings/sections/occurrence/max_depth/include_nested ' +
            'apply to the TARGET document. Pre-resolution errors (path missing, wrong type, target not found) are returned at the top level. ' +
            'Post-resolution errors (section not found, occurrence out of range) are nested under "followed_ref".'
          ),
        },
      },
      async ({ identifiers, include, sections, include_nested, occurrence: occurrenceParam, max_depth, follow_ref: followRef }) => {
        if (getIsShuttingDown()) {
          return {
            content: [{ type: 'text' as const, text: 'Server is shutting down; new requests cannot be processed' }],
            isError: true,
          };
        }
        const occurrence = occurrenceParam ?? 1;
        const effectiveInclude: Array<'body' | 'frontmatter' | 'headings'> = include && include.length > 0 ? include : ['body'];
        const sectionsList = sections ?? [];
        const effectiveMaxDepth = max_depth ?? 6;
        // WR-02: explicit fallback in case MCP SDK strips the Zod .default(true)
        const effectiveIncludeNested = include_nested ?? true;

        if (!Number.isInteger(occurrence) || occurrence < 1) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: 'occurrence must be a positive integer.',
            details: { field: 'occurrence', value: occurrence },
          });
        }

        if (!Number.isInteger(effectiveMaxDepth) || effectiveMaxDepth < 1 || effectiveMaxDepth > 6) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: 'max_depth must be an integer between 1 and 6.',
            details: { field: 'max_depth', value: effectiveMaxDepth, min: 1, max: 6 },
          });
        }

        const paramError = validateParameterCombinations({
          include: [...effectiveInclude],
          sections: sectionsList,
          occurrence,
        });
        if (paramError !== null) {
          return jsonExpectedError({
            error: 'invalid_input',
            message: paramError.message,
            details: paramError.details,
          });
        }

        // Build the per-element options bundle once
        const elementOptions = {
          effectiveInclude: [...effectiveInclude] as Array<'body' | 'frontmatter' | 'headings'>,
          sectionsList,
          effectiveIncludeNested,
          occurrence,
          effectiveMaxDepth,
          followRef,
        };
        const deps = { config, supabaseManager, embeddingProvider, logger, scheduleDocumentEmbedding };

        if (Array.isArray(identifiers)) {
          // FREF-04 / FREF-05: batch — per-element partial failure; outer call never isError
          const results = await Promise.all(
            identifiers.map(async (id) => {
              try {
                return await resolveAndBuildDocument(id, elementOptions, deps);
              } catch (err) {
                if (err instanceof DocumentRequestError) {
                  // section_not_found / follow_ref_*_error etc. — embed the helper-normalized envelope at this position
                  return JSON.parse(jsonExpectedError(err.envelope).content[0]?.text ?? '{}') as ErrorEnvelope;
                }
                const msg = err instanceof Error ? err.message : String(err);
                const isNotFound =
                  msg.toLowerCase().includes('not found') ||
                  msg.toLowerCase().includes('missing') ||
                  msg.toLowerCase().includes('enoent');
                return {
                  error: isNotFound ? 'not_found' : 'runtime_error',
                  message: isNotFound
                    ? `No document found for identifier: ${id}`
                    : `Error reading document: ${msg}`,
                  identifier: id,
                };
              }
            })
          );
          return jsonToolResult(results);
        }

        // Single-string path — backward-compatible flat object response
        try {
          const result = await resolveAndBuildDocument(identifiers, elementOptions, deps);
          return jsonToolResult(result);
        } catch (err) {
          if (err instanceof DocumentRequestError) {
            return jsonExpectedError(err.envelope);
          }
          const msg = err instanceof Error ? err.message : String(err);
          logger.error(`get_document failed - ${msg}`);
          const isNotFound =
            msg.toLowerCase().includes('not found') ||
            msg.toLowerCase().includes('missing') ||
            msg.toLowerCase().includes('enoent');
          if (isNotFound) {
            return jsonExpectedError({
              error: 'not_found',
              message: `No document found for identifier: ${identifiers}`,
              identifier: identifiers,
            });
          }
          return jsonRuntimeError({ message: `Error reading document: ${msg}`, identifier: identifiers });
        }
      }
    );
}
