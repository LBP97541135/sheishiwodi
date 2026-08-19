import { describe, expect, it } from 'vitest';

import type { HumanGameView, ReviewGeneration, ReviewSummary } from '@sheishiwodi/shared';

import type { ReviewInput, ReviewPolicy } from '../agents/review-policy.js';
import type { AgentObservability, AttemptHandle } from '../agents/agent-observability.js';
import type { GameRepository } from './game-repository.js';
import { ReviewService } from './review-service.js';

class ReviewRepositoryStub {
  readonly summaries = new Map<string, ReviewSummary>();
  active = false;

  getReviewSummary(gameId: string) {
    return this.summaries.get(gameId) ?? null;
  }

  upsertReviewSummary(summary: ReviewSummary) {
    this.summaries.set(summary.gameId, summary);
  }

  findActiveSnapshot() {
    return this.active ? ({ status: 'in_progress' } as never) : null;
  }

  getHumanView(gameId: string) {
    return finishedView(gameId);
  }

  listRecoverableReviewGameIds() {
    return [...this.summaries.values()]
      .filter((summary) => summary.status === 'pending' || summary.status === 'generating')
      .map((summary) => summary.gameId);
  }
}

class DeferredReviewPolicy implements ReviewPolicy {
  readonly modelId = 'review-model';
  readonly calls: string[] = [];
  private readonly resolvers: Array<(value: ReviewGeneration) => void> = [];

  generate(input: ReviewInput): Promise<ReviewGeneration> {
    this.calls.push(input.gameId);
    return new Promise((resolve) => this.resolvers.push(resolve));
  }

  resolveNext() {
    this.resolvers.shift()?.({
      perAgent: [
        { playerId: 'agent-1', verdict: '证据更新合理', keyMoments: ['第1轮'], rating: 4 },
      ],
      overall: '关键投票决定结果',
    });
  }
}

class ImmediateLifecycleReviewPolicy implements ReviewPolicy {
  readonly modelId = 'review-model';

  async generate(
    _input: ReviewInput,
    context?: { lifecycle?: { validatedAttemptId?: string } },
  ): Promise<ReviewGeneration> {
    if (context?.lifecycle) context.lifecycle.validatedAttemptId = 'review-attempt-1';
    return {
      perAgent: [
        { playerId: 'agent-1', verdict: '证据更新合理', keyMoments: ['第1轮'], rating: 4 },
      ],
      overall: '关键投票决定结果',
    };
  }
}

class LifecycleObservability implements AgentObservability {
  readonly stages: string[] = [];
  readonly outcomes: string[] = [];

  beginPlayerAttempt(): AttemptHandle {
    throw new Error('Unexpected player attempt');
  }

  beginReviewAttempt(): AttemptHandle {
    throw new Error('Unexpected review attempt');
  }

  finishAttempt(): void {}

  markAttemptStage(_attemptId: string, stage: string): void {
    this.stages.push(stage);
  }

  finalizeAttempt(_attemptId: string, resultCode: string): void {
    this.outcomes.push(resultCode);
  }
}

describe('ReviewService scheduler', () => {
  it('复盘摘要持久化完成后才把 attempt 标记为动作已提交', async () => {
    const repository = new ReviewRepositoryStub();
    const observability = new LifecycleObservability();
    const service = new ReviewService(
      repository as unknown as GameRepository,
      { now: () => '2026-08-19T05:00:00.000Z' },
      () => new ImmediateLifecycleReviewPolicy(),
      observability,
    );

    service.enqueue('game-review-lifecycle');
    await service.shutdown();

    expect(repository.summaries.get('game-review-lifecycle')?.status).toBe('done');
    expect(observability.stages).toEqual(['content_validated', 'action_committed']);
    expect(observability.outcomes).toEqual(['action_committed']);
  });

  it('活动局阻止新复盘，且全局只运行一个；在途完成后仍等待活动局结束', async () => {
    const repository = new ReviewRepositoryStub();
    const policy = new DeferredReviewPolicy();
    const service = new ReviewService(
      repository as unknown as GameRepository,
      { now: () => '2026-08-19T05:00:00.000Z' },
      () => policy,
    );

    repository.active = true;
    expect(service.enqueue('game-1').status).toBe('pending');
    expect(policy.calls).toEqual([]);

    repository.active = false;
    service.kick();
    await flush();
    expect(policy.calls).toEqual(['game-1']);

    repository.active = true;
    service.enqueue('game-2');
    expect(policy.calls).toEqual(['game-1']);
    policy.resolveNext();
    await flush();
    expect(repository.summaries.get('game-1')?.status).toBe('done');
    expect(repository.summaries.get('game-2')?.status).toBe('pending');
    expect(policy.calls).toEqual(['game-1']);

    repository.active = false;
    service.kick();
    await flush();
    expect(policy.calls).toEqual(['game-1', 'game-2']);
    policy.resolveNext();
    await service.shutdown();
    expect(repository.summaries.get('game-2')?.status).toBe('done');
  });

  it('重启恢复时把 generating 退回 pending，并优先最近一局再处理旧任务', async () => {
    const repository = new ReviewRepositoryStub();
    repository.summaries.set('game-old', pendingSummary('game-old', 'pending'));
    repository.summaries.set('game-current', pendingSummary('game-current', 'generating'));
    const policy = new DeferredReviewPolicy();
    const service = new ReviewService(
      repository as unknown as GameRepository,
      { now: () => '2026-08-19T05:00:00.000Z' },
      () => policy,
    );

    service.recover();
    await flush();
    expect(policy.calls).toEqual(['game-current']);
    expect(repository.summaries.get('game-current')?.status).toBe('generating');

    policy.resolveNext();
    await flush();
    expect(policy.calls).toEqual(['game-current', 'game-old']);
    policy.resolveNext();
    await service.shutdown();
    expect(repository.summaries.get('game-old')?.status).toBe('done');
  });
});

const flush = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

function finishedView(gameId: string): HumanGameView {
  return {
    gameId,
    status: 'finished',
    phase: 'ended',
    revision: 1,
    eventCursor: 1,
    config: { undercoverCount: 1, difficulty: 'easy' },
    human: {
      playerId: 'human-1',
      displayName: '玩家',
      silhouette: 'silhouette_a',
      ownWordCard: '牛奶',
    },
    players: [
      { playerId: 'human-1', seatIndex: 0, kind: 'human', displayName: '玩家', alive: true },
      { playerId: 'agent-1', seatIndex: 1, kind: 'agent', displayName: 'AI', alive: false },
    ],
    round: null,
    publicTimeline: [],
    voteProgress: { completedPlayerIds: [] },
    legalVoteTargetIds: [],
    winnerCamp: 'civilian',
    endReason: 'undercover_eliminated',
    reveal: {
      wordPair: { civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品' },
      players: [
        { playerId: 'human-1', seatIndex: 0, camp: 'civilian', wordCard: '牛奶' },
        { playerId: 'agent-1', seatIndex: 1, camp: 'undercover', wordCard: '豆浆' },
      ],
    },
    factReview: { agentActions: [] },
    allowedCommands: [],
    operationalStatus: { state: 'idle' },
  };
}

function pendingSummary(gameId: string, status: 'pending' | 'generating'): ReviewSummary {
  return { gameId, status, modelId: 'review-model', perAgent: [], overall: '' };
}
