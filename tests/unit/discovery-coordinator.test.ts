import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FlashQueryConfig } from '../../src/config/loader.js';

// Mock dependencies
vi.mock('../../src/services/plugin-skill-invoker.js');
vi.mock('../../src/services/document-ownership.js');
vi.mock('../../src/logging/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { processDiscoveryQueueAsync, type DiscoveryQueueItem } from '../../src/services/discovery-coordinator.js';
import { logger } from '../../src/logging/logger.js';
import * as skillInvoker from '../../src/services/plugin-skill-invoker.js';
import * as ownershipModule from '../../src/services/document-ownership.js';

// Test configuration
const testConfig: FlashQueryConfig = {
  instance: {
    id: 'test-instance',
    vault: { path: '/tmp/test-vault', markdownExtensions: ['.md'] },
  },
  supabase: {
    url: 'https://test.supabase.co',
    serviceRoleKey: 'test-key',
  },
} as unknown as FlashQueryConfig;

describe('Discovery Coordinator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('processes a valid skill result and updates document ownership', async () => {
    // Setup
    const queueItem: DiscoveryQueueItem = {
      fqcId: '550e8400-e29b-41d4-a716-446655440001',
      path: 'CRM/Contacts/Sarah.md',
      pluginId: 'crm',
    };

    vi.mocked(skillInvoker.invokePluginDiscoverySkill).mockResolvedValue({
      owned: true,
      plugin_id: 'crm',
      type: 'contact',
    });

    const mockUpdateOwnership = vi.fn().mockResolvedValue(undefined);
    vi.mocked(ownershipModule.updateDocumentOwnership).mockImplementation(mockUpdateOwnership);

    // Execute
    await processDiscoveryQueueAsync([queueItem], testConfig);

    // Verify
    expect(skillInvoker.invokePluginDiscoverySkill).toHaveBeenCalledWith(queueItem, testConfig);
    expect(mockUpdateOwnership).toHaveBeenCalledWith(queueItem.fqcId, {
      plugin_id: 'crm',
      type: 'contact',
      needs_discovery: false,
    });
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Starting async discovery processing')
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Async discovery processing complete')
    );
  });

  it('handles skill errors gracefully and keeps needs_discovery=true', async () => {
    // Setup
    const queueItem: DiscoveryQueueItem = {
      fqcId: '550e8400-e29b-41d4-a716-446655440002',
      path: 'CRM/Contacts/John.md',
      pluginId: 'crm',
    };

    const skillError = new Error('Plugin skill failed: invalid file format');
    vi.mocked(skillInvoker.invokePluginDiscoverySkill).mockRejectedValue(skillError);

    // Execute (should not throw)
    await expect(
      processDiscoveryQueueAsync([queueItem], testConfig)
    ).resolves.toBeUndefined();

    // Verify: skill was invoked, but ownership was NOT updated
    expect(skillInvoker.invokePluginDiscoverySkill).toHaveBeenCalledWith(queueItem, testConfig);
    expect(ownershipModule.updateDocumentOwnership).not.toHaveBeenCalled();

    // Error was logged
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Discovery failed for CRM/Contacts/John.md'),
      skillError
    );
  });

  it('processes empty queue without error', async () => {
    // Execute
    await expect(processDiscoveryQueueAsync([], testConfig)).resolves.toBeUndefined();

    // Verify: no skills invoked, no updates
    expect(skillInvoker.invokePluginDiscoverySkill).not.toHaveBeenCalled();
    expect(ownershipModule.updateDocumentOwnership).not.toHaveBeenCalled();

    // Debug log for empty queue
    expect(logger.debug).toHaveBeenCalledWith(
      'Discovery queue is empty, skipping processing'
    );
  });

  it('processes multiple queue items sequentially and continues on error', async () => {
    // Setup: 3 items, middle one fails
    const queue: DiscoveryQueueItem[] = [
      {
        fqcId: '550e8400-e29b-41d4-a716-446655440001',
        path: 'CRM/Contacts/Sarah.md',
        pluginId: 'crm',
      },
      {
        fqcId: '550e8400-e29b-41d4-a716-446655440002',
        path: 'CRM/Contacts/John.md',
        pluginId: 'crm',
      },
      {
        fqcId: '550e8400-e29b-41d4-a716-446655440003',
        path: 'CRM/Companies/Acme.md',
        pluginId: 'crm',
      },
    ];

    // First succeeds, second fails, third succeeds
    vi.mocked(skillInvoker.invokePluginDiscoverySkill)
      .mockResolvedValueOnce({
        owned: true,
        plugin_id: 'crm',
        type: 'contact',
      })
      .mockRejectedValueOnce(new Error('Skill error for item 2'))
      .mockResolvedValueOnce({
        owned: true,
        plugin_id: 'crm',
        type: 'company',
      });

    const mockUpdateOwnership = vi.fn().mockResolvedValue(undefined);
    vi.mocked(ownershipModule.updateDocumentOwnership).mockImplementation(mockUpdateOwnership);

    // Execute
    await expect(processDiscoveryQueueAsync(queue, testConfig)).resolves.toBeUndefined();

    // Verify: all skills invoked (order preserved)
    expect(skillInvoker.invokePluginDiscoverySkill).toHaveBeenCalledTimes(3);

    // Verify: ownership updated for items 1 and 3, skipped for item 2
    expect(mockUpdateOwnership).toHaveBeenCalledTimes(2);
    expect(mockUpdateOwnership).toHaveBeenNthCalledWith(1, queue[0].fqcId, {
      plugin_id: 'crm',
      type: 'contact',
      needs_discovery: false,
    });
    expect(mockUpdateOwnership).toHaveBeenNthCalledWith(2, queue[2].fqcId, {
      plugin_id: 'crm',
      type: 'company',
      needs_discovery: false,
    });

    // Error logged for item 2
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Discovery failed for CRM/Contacts/John.md'),
      expect.any(Error)
    );
  });
});
