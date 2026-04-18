import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { logger } from '../../logging/logger.js';
import type { FlashQueryConfig } from '../../config/loader.js';
import { getIsShuttingDown } from '../../server/shutdown-state.js';

// ─────────────────────────────────────────────────────────────────────────────
// registerProjectTools — registers list_projects and get_project_info
// Both tools are deprecated since v1.7 (projects model removed).
// ─────────────────────────────────────────────────────────────────────────────

export function registerProjectTools(server: McpServer, _config: FlashQueryConfig): void {
  // ─── Tool 1: list_projects ─────────────────────────────────────────────────

  server.registerTool(
    'list_projects',
    {
      description:
        '@deprecated Projects model removed in v1.7. Use `fqc scan` to list vault files.',
      inputSchema: {},
    },
    async () => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Server is shutting down; new requests cannot be processed',
            },
          ],
          isError: true,
        };
      }

      logger.info('list_projects: deprecated — projects model removed in v1.7');
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Projects model removed in v1.7. Scoping is now path-based (user-managed folder structure) + tag-based (characteristics). Use `fqc scan` to discover and index vault files.',
          },
        ],
      };
    }
  );

  // ─── Tool 2: get_project_info (deprecated) ─────────────────────────────────

  server.registerTool(
    'get_project_info',
    {
      description:
        '@deprecated Projects model removed in v1.7. Use tags for categorization and `search_documents` for discovery.',
      inputSchema: {
        project: z.string().optional().describe('@deprecated This parameter is ignored.'),
      },
    },
    async () => {
      // D-02b: Check shutdown flag immediately
      if (getIsShuttingDown()) {
        return {
          content: [
            {
              type: 'text' as const,
              text: 'Server is shutting down; new requests cannot be processed',
            },
          ],
          isError: true,
        };
      }

      logger.info('get_project_info: deprecated — projects model removed in v1.7');
      return {
        content: [
          {
            type: 'text' as const,
            text: 'Projects model removed in v1.7. Scoping is now path-based (user-managed folder structure) + tag-based (characteristics). Use `search_documents` with tags to find related documents.',
          },
        ],
      };
    }
  );
}
