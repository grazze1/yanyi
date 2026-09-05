import { beforeEach, describe, expect, it, vi } from 'vitest';

const { invokeMock } = vi.hoisted(() => ({ invokeMock: vi.fn() }));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));

import { desktopApi, type GlobalMemoryInput, type ModelSelectionInput } from './desktopApi';

describe('desktopApi final remediation commands', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('passes the complete conversation query and message pagination to Tauri', async () => {
    await desktopApi.conversations({
      search: 'tensor',
      status: 'archived',
      offset: 20,
      limit: 20,
    });
    await desktopApi.conversation('conversation-1', 40, 40);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'conversation_list', {
      search: 'tensor',
      status: 'archived',
      offset: 20,
      limit: 20,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'conversation_get', {
      conversationId: 'conversation-1',
      messageOffset: 40,
      messageLimit: 40,
    });
  });

  it('wires every mutating conversation action including explicit delete confirmation', async () => {
    await desktopApi.renameConversation('conversation-1', 'Tensor 解释');
    await desktopApi.archiveConversation('conversation-1', true);
    await desktopApi.deleteConversation('conversation-1', true);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'conversation_rename', {
      conversationId: 'conversation-1',
      title: 'Tensor 解释',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'conversation_archive', {
      conversationId: 'conversation-1',
      archived: true,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'conversation_delete', {
      conversationId: 'conversation-1',
      confirmed: true,
    });
  });

  it('uses the requested provider for catalog reads and refreshes', async () => {
    await desktopApi.modelCatalog('deepseek');
    await desktopApi.refreshModelCatalog('deepseek');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'model_catalog_list', {
      providerId: 'deepseek',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'model_catalog_refresh', {
      providerId: 'deepseek',
    });
  });

  it('persists an exact task model selection without a fallback field', async () => {
    const input: ModelSelectionInput = {
      scope: 'task',
      scopeId: 'deep_follow_up',
      task: 'deep_follow_up',
      modelId: 'deepseek-v4-pro',
      thinkingEnabled: true,
      reasoningEffort: 'max',
    };

    await desktopApi.modelSelection('deep_follow_up');
    await desktopApi.saveModelSelection('deepseek', input);

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'model_selection_get', {
      conversationId: undefined,
      task: 'deep_follow_up',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'model_selection_set', {
      providerId: 'deepseek',
      input,
    });
  });

  it('wires full global memory CRUD', async () => {
    const input: GlobalMemoryInput = {
      type: 'response_style',
      title: '回答风格',
      content: '先给结论，再解释原理。',
      enabled: true,
      pinned: true,
      priority: 10,
      tags: ['通用'],
    };

    await desktopApi.globalMemories('ROS', 'domain_background');
    await desktopApi.createGlobalMemory(input);
    await desktopApi.updateGlobalMemory('memory-1', input);
    await desktopApi.setGlobalMemoryEnabled('memory-1', false);
    await desktopApi.setGlobalMemoryPinned('memory-1', true);
    await desktopApi.deleteGlobalMemory('memory-1');

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'global_memory_list', {
      search: 'ROS',
      memoryType: 'domain_background',
      limit: 200,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'global_memory_create', { input });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'global_memory_update', {
      id: 'memory-1',
      input,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(4, 'global_memory_set_enabled', {
      id: 'memory-1',
      enabled: false,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(5, 'global_memory_set_pinned', {
      id: 'memory-1',
      pinned: true,
    });
    expect(invokeMock).toHaveBeenNthCalledWith(6, 'global_memory_delete', { id: 'memory-1' });
  });

  it('keeps memory import a two-step review, never a direct write', async () => {
    await desktopApi.previewGlobalMemoryImport('C:/tmp/profile.md', 'profile');
    await desktopApi.applyGlobalMemoryImport('job-1', ['candidate-1']);
    await desktopApi.discardGlobalMemoryImport('job-2');

    // Preview only parses and stores candidates; nothing is written yet.
    expect(invokeMock).toHaveBeenNthCalledWith(1, 'global_memory_import_preview', {
      path: 'C:/tmp/profile.md',
      defaultType: 'profile',
    });
    // Writing requires an explicit list of confirmed candidate IDs.
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'global_memory_import_apply', {
      jobId: 'job-1',
      acceptedIds: ['candidate-1'],
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, 'global_memory_import_discard', {
      jobId: 'job-2',
    });
  });

  it('exposes the stable snapshot and export for user inspection', async () => {
    await desktopApi.globalMemorySnapshot();
    await desktopApi.exportGlobalMemories();

    expect(invokeMock).toHaveBeenNthCalledWith(1, 'global_memory_snapshot');
    expect(invokeMock).toHaveBeenNthCalledWith(2, 'global_memory_export');
  });
});
