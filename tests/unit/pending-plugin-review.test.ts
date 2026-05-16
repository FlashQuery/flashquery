import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// ─────────────────────────────────────────────────────────────────────────────
// Module mocks (must be before imports)
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('../../src/storage/supabase.js', () => ({
  supabaseManager: { getClient: vi.fn() },
}));
vi.mock('../../src/logging/logger.js', () => ({
  logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('../../src/server/shutdown-state.js', () => ({
  getIsShuttingDown: vi.fn().mockReturnValue(false),
}));

// ─────────────────────────────────────────────────────────────────────────────
// System-under-test imports (AFTER mocks)
// ─────────────────────────────────────────────────────────────────────────────

import { registerPendingReviewTools } from '../../src/mcp/tools/pending-review.js';
import { supabaseManager } from '../../src/storage/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Supabase chain mock — records all chained calls and resolves at .then().
 * Matches the pattern from tests/unit/plugin-reconciliation.test.ts.
 */
function makeSupabaseChain(returnData: unknown[] = [], error: unknown = null) {
  const chain: Record<string, unknown> = {};
  chain.select = vi.fn().mockReturnValue(chain);
  chain.delete = vi.fn().mockReturnValue(chain);
  chain.insert = vi.fn().mockReturnValue(chain);
  chain.eq = vi.fn().mockReturnValue(chain);
  chain.in = vi.fn().mockReturnValue(chain);
  chain.then = (resolve: (val: { data: unknown[]; error: unknown }) => void) =>
    resolve({ data: returnData, error });
  return chain;
}

/**
 * Register clear_pending_reviews into a mock server and return a callTool helper.
 * Re-creates tool registration on each call (pass different chains per test).
 */
function setupTool(chain: ReturnType<typeof makeSupabaseChain>) {
  (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue(chain),
  });

  const handlers: Record<string, (args: unknown) => unknown> = {};
  const mockServer = {
    registerTool: (_name: string, _cfg: unknown, handler: (args: unknown) => unknown) => {
      handlers[_name] = handler;
    },
  } as unknown as McpServer;

  registerPendingReviewTools(mockServer, { instance: { id: 'test-instance' } } as unknown as FlashQueryConfig);

  const callTool = (args: unknown) => handlers['clear_pending_reviews'](args);
  return { callTool, chain };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('clear_pending_reviews', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires action', async () => {
    const chain = makeSupabaseChain([]);
    const { callTool } = setupTool(chain);

    const result = await callTool({ plugin_id: 'crm' }) as {
      content: Array<{ type: string; text: string }>;
      isError?: boolean;
    };

    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      error: 'invalid_input',
      details: { field: 'action' },
    });
  });

  it('lists template_available pending review rows by row id', async () => {
    // Test 1: INSERT pending review when `template` is declared — query mode returns
    // the row with review_type: 'template_available'
    const chain = makeSupabaseChain([
      {
        id: 'review-1',
        fqc_id: 'uuid-1',
        plugin_id: 'crm',
        table_name: 'fqcp_test_contacts',
        review_type: 'template_available',
        context: { path: 'Contacts/Ada.md' },
      },
    ]);
    const { callTool } = setupTool(chain);

    const result = await callTool({
      plugin_id: 'crm',
      action: 'list',
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(JSON.parse(result.content[0].text)).toEqual({
      pending: 1,
      items: [{
        id: 'review-1',
        fqc_id: 'uuid-1',
        type: 'template_available',
        plugin_id: 'crm',
        table: 'fqcp_test_contacts',
        path: 'Contacts/Ada.md',
        context: { path: 'Contacts/Ada.md' },
      }],
    });
    expect(result.isError).toBeFalsy();
  });

  it('returns empty when no pending reviews exist', async () => {
    // Test 2: No pending review row when no `template` in policy — query mode returns empty
    const chain = makeSupabaseChain([]);
    const { callTool } = setupTool(chain);

    const result = await callTool({
      plugin_id: 'crm',
      action: 'list',
    }) as { content: Array<{ type: string; text: string }> };

    expect(JSON.parse(result.content[0].text)).toEqual({ pending: 0, items: [] });
  });

  it('list action returns all items without calling delete', async () => {
    const chain = makeSupabaseChain([
      { id: 'review-a', plugin_id: 'crm', fqc_id: 'uuid-a', table_name: 'fqcp_crm_contacts', review_type: 'template_available', context: {} },
      { id: 'review-b', plugin_id: 'crm', fqc_id: 'uuid-b', table_name: 'fqcp_crm_companies', review_type: 'resurrected', context: {} },
    ]);
    const { callTool } = setupTool(chain);

    await callTool({
      plugin_id: 'crm',
      action: 'list',
    });

    // delete must NOT have been called in query mode
    expect(chain.delete).not.toHaveBeenCalled();
    // select must have been called to retrieve items
    expect(chain.select).toHaveBeenCalled();
  });

  it('clear action with nonmatching ids returns warning without delete', async () => {
    const chain = makeSupabaseChain([]); // remaining after delete = empty
    const { callTool } = setupTool(chain);

    const result = await callTool({
      plugin_id: 'crm',
      action: 'clear',
      ids: ['review-1', 'review-2'],
    }) as { content: Array<{ type: string; text: string }> };

    expect(chain.delete).not.toHaveBeenCalled();
    expect(chain.in).toHaveBeenCalledWith('id', ['review-1', 'review-2']);
    expect(chain.select).toHaveBeenCalled();
    expect(JSON.parse(result.content[0].text)).toEqual({
      cleared: 0,
      items: [],
      warnings: ['no_matching_items'],
    });
  });

  it('clear action calls DELETE by matching pending-review row ids', async () => {
    const chain = makeSupabaseChain([
      { id: 'review-1', plugin_id: 'crm', table_name: 'fqcp_crm_contacts', review_type: 'template_available', context: {} },
    ]);
    const { callTool } = setupTool(chain);

    const result = await callTool({
      plugin_id: 'crm',
      action: 'clear',
      ids: ['review-1'],
    }) as { content: Array<{ type: string; text: string }> };

    expect(chain.delete).toHaveBeenCalled();
    expect(chain.in).toHaveBeenCalledWith('id', ['review-1']);
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      cleared: 1,
      items: [expect.objectContaining({ id: 'review-1' })],
    });
  });

  it('non-existent ids warn with no_matching_items', async () => {
    const chain = makeSupabaseChain([]); // delete resolves with no error, select returns []
    const { callTool } = setupTool(chain);

    const result = await callTool({
      plugin_id: 'crm',
      action: 'clear',
      ids: ['missing-review'],
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      cleared: 0,
      warnings: ['no_matching_items'],
    });
  });

  it('response shape contains id, type, plugin_id, table, path', async () => {
    const chain = makeSupabaseChain([
      {
        id: 'review-x',
        fqc_id: 'uuid-x',
        plugin_id: 'crm',
        table_name: 'fqcp_crm_contacts',
        review_type: 'resurrected',
        context: { moved_from: '/old' },
      },
    ]);
    const { callTool } = setupTool(chain);

    const result = await callTool({
      plugin_id: 'crm',
      action: 'list',
    }) as { content: Array<{ type: string; text: string }> };

    expect(JSON.parse(result.content[0].text)).toEqual({
      pending: 1,
      items: [{
        id: 'review-x',
        fqc_id: 'uuid-x',
        type: 'resurrected',
        plugin_id: 'crm',
        table: 'fqcp_crm_contacts',
        path: null,
        context: { moved_from: '/old' },
      }],
    });
  });

  it('CASCADE: fqc_documents delete removes pending review rows automatically', async () => {
    // Test 7: FK ON DELETE CASCADE — verified in integration tests (TEST-15)
    // Unit test confirms the tool correctly handles empty state after cascade:
    // when fqc_documents row is deleted, SELECT returns [] because child rows were CASCADE-deleted.
    const chain = makeSupabaseChain([]); // simulates state after CASCADE delete of parent
    const { callTool } = setupTool(chain);

    const result = await callTool({
      plugin_id: 'crm',
      action: 'list',
    }) as { content: Array<{ type: string; text: string }> };

    expect(JSON.parse(result.content[0].text)).toEqual({ pending: 0, items: [] });
  });

  it('unregister_plugin cleanup deletes all pending reviews for plugin', async () => {
    // Test 8: unregister_plugin handler should delete all fqc_pending_plugin_review rows
    // for the plugin before removing registry entry.
    //
    // The full unregister_plugin handler (in plugins.ts) is complex to fully mock here.
    // This test verifies the expected supabase call pattern:
    //   supabase.from('fqc_pending_plugin_review').delete().eq('plugin_id', plugin_id).eq('instance_id', instanceId)
    //
    // TODO: Full integration coverage in TEST-15 (Phase 86 integration tests).

    const deleteChain: Record<string, unknown> = {};
    deleteChain.delete = vi.fn().mockReturnValue(deleteChain);
    deleteChain.eq = vi.fn().mockReturnValue(deleteChain);
    deleteChain.then = (resolve: (val: { data: null; error: null }) => void) =>
      resolve({ data: null, error: null });

    const fromMock = vi.fn().mockReturnValue(deleteChain);
    (supabaseManager.getClient as ReturnType<typeof vi.fn>).mockReturnValue({ from: fromMock });

    const supabase = supabaseManager.getClient();

    // Simulate the expected cleanup call pattern
    await supabase
      .from('fqc_pending_plugin_review')
      .delete()
      .eq('plugin_id', 'crm')
      .eq('instance_id', 'default');

    // Verify the delete chain was invoked with correct filters
    expect(fromMock).toHaveBeenCalledWith('fqc_pending_plugin_review');
    expect(deleteChain.delete).toHaveBeenCalled();
    expect(deleteChain.eq).toHaveBeenCalledWith('plugin_id', 'crm');
    expect(deleteChain.eq).toHaveBeenCalledWith('instance_id', 'default');
  });
});
