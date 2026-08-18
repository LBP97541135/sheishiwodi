import { describe, expect, it, vi } from 'vitest';

import type { WordPairRepository } from '../db/word-pair-repository.js';
import type { GameRepository } from './game-repository.js';
import { GameService } from './game-service.js';

describe('GameService model configuration guard', () => {
  it('模型未配齐时在状态机转换和 Agent 调用前拒绝开始', async () => {
    const findSnapshot = vi.fn(() => ({ gameId: 'game-1' }));
    const games = {
      findProcessedCommand: () => null,
      findSnapshot,
    } as unknown as GameRepository;
    const service = new GameService(games, {} as WordPairRepository, {
      random: { next: () => 0 },
      ids: { nextId: () => 'unused' },
      clock: { now: () => '2026-08-18T12:00:00.000Z' },
      areRequiredModelsConfigured: () => false,
      agentPolicyFactory: () => {
        throw new Error('模型策略不应被创建');
      },
    });

    await expect(
      service.startGame({
        type: 'StartGame',
        commandId: 'start-model-guard',
        gameId: 'game-1',
        actorId: 'human-1',
        expectedRevision: 0,
      }),
    ).rejects.toMatchObject({ code: 'MODEL_CONFIGURATION_REQUIRED' });
    expect(findSnapshot).toHaveBeenCalledWith('game-1');
  });
});
