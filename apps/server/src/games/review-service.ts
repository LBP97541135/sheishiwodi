import type { Clock, ReviewErrorCode, ReviewSummary } from '@sheishiwodi/shared';

import { FakeReviewPolicy } from '../agents/fake-review-policy.js';
import type { AgentObservability } from '../agents/agent-observability.js';
import { buildReviewInput, type ReviewPolicy } from '../agents/review-policy.js';
import {
  ReviewRuntimeInterruptedError,
  ReviewSystemError,
} from '../agents/review-agent-policy.js';
import { buildReviewMarkdown } from './review-markdown.js';
import type { GameRepository } from './game-repository.js';

export type ReviewServiceErrorCode = 'GAME_NOT_FOUND' | 'NOT_FINISHED';

export class ReviewServiceError extends Error {
  constructor(readonly code: ReviewServiceErrorCode) {
    super(code);
    this.name = 'ReviewServiceError';
  }
}

/**
 * 赛后复盘调度（v1，非 DEC-032 完整优先级调度器）：终局后台异步生成 AI 评价，
 * 单飞守卫保证同一局至多一个生成在跑；不阻塞玩家交互。失败仅脱敏落库/记日志。
 */
export class ReviewService {
  private runningGameId: string | null = null;
  private runningPromise: Promise<void> | null = null;
  private readonly queue: string[] = [];
  private stopped = false;

  constructor(
    private readonly games: GameRepository,
    private readonly clock: Clock,
    private readonly policyFactory: () => ReviewPolicy = () => new FakeReviewPolicy(),
    private readonly observability?: AgentObservability,
  ) {}

  /** 终局回调：写入 pending 并 fire-and-forget 后台生成。幂等：已有 done/进行中则跳过。 */
  enqueue(gameId: string, options: { force?: boolean } = {}): ReviewSummary {
    const existing = this.games.getReviewSummary(gameId);
    if (!options.force && existing) {
      if (existing.status === 'done') return existing;
      if (existing.status === 'generating' || this.runningGameId === gameId) return existing;
      // pending 但没有在跑（如重启后）——继续往下重新触发。
    }
    if (this.runningGameId === gameId) {
      return existing ?? this.pendingSummary(gameId, this.resolveModelId());
    }

    const pending = this.pendingSummary(gameId, this.resolveModelId());
    this.games.upsertReviewSummary(pending, this.clock.now());
    this.enqueueFirst(gameId);
    this.kick();
    return pending;
  }

  /** 读取复盘：无记录但对局为正常终局时惰性入队（兼容本特性上线前的历史局）。 */
  getReview(gameId: string): ReviewSummary {
    const existing = this.games.getReviewSummary(gameId);
    if (existing) {
      if (existing.status === 'pending' && this.runningGameId !== gameId) {
        this.enqueueFirst(gameId);
        this.kick();
      }
      return existing;
    }
    const view = this.games.getHumanView(gameId);
    if (!view) throw new ReviewServiceError('GAME_NOT_FOUND');
    if (view.status !== 'finished' || !view.reveal) throw new ReviewServiceError('NOT_FINISHED');
    return this.enqueue(gameId);
  }

  /** 显式重新生成（失败后或想重跑）。 */
  regenerate(gameId: string): ReviewSummary {
    const view = this.games.getHumanView(gameId);
    if (!view) throw new ReviewServiceError('GAME_NOT_FOUND');
    if (view.status !== 'finished' || !view.reveal) throw new ReviewServiceError('NOT_FINISHED');
    return this.enqueue(gameId, { force: true });
  }

  /**
   * 导出单局复盘为脱敏 Markdown（DEC-047）：组合终局事实与已生成的 AI 评价。
   * AI 评价缺失/生成中/失败时仍可导出（仅事实部分，评价区标注状态）。
   */
  exportMarkdown(gameId: string): string {
    const view = this.games.getHumanView(gameId);
    if (!view) throw new ReviewServiceError('GAME_NOT_FOUND');
    const input = buildReviewInput(view);
    if (!input) throw new ReviewServiceError('NOT_FINISHED');
    return buildReviewMarkdown({ input, summary: this.games.getReviewSummary(gameId) });
  }

  /** 重启恢复：把遗留 pending/generating 的复盘重新入队。 */
  recover() {
    const recoverable = this.games.listRecoverableReviewGameIds();
    const currentFirst = recoverable.length > 1
      ? [recoverable.at(-1)!, ...recoverable.slice(0, -1)]
      : recoverable;
    for (const gameId of currentFirst) {
      const existing = this.games.getReviewSummary(gameId);
      if (existing?.status === 'generating') {
        this.games.upsertReviewSummary(
          { ...existing, status: 'pending' },
          this.clock.now(),
        );
      }
      this.enqueueLast(gameId);
    }
    this.kick();
  }

  kick() {
    if (this.stopped || this.runningGameId || this.games.findActiveSnapshot()) return;
    const gameId = this.queue.shift();
    if (!gameId) return;
    this.runningGameId = gameId;
    this.runningPromise = this.run(gameId).catch((error: unknown) => {
      console.error('[review] 后台生成失败：', error instanceof Error ? error.name : 'unknown');
    });
  }

  async shutdown() {
    this.stopped = true;
    await this.runningPromise;
  }

  snapshot() {
    return {
      runningGameId: this.runningGameId,
      queuedGameIds: [...this.queue],
      blockedByActiveGame: Boolean(this.games.findActiveSnapshot()),
      stopped: this.stopped,
    };
  }

  private async run(gameId: string) {
    let modelId = this.resolveModelId();
    try {
      const policy = this.policyFactory();
      modelId = policy.modelId;
      this.games.upsertReviewSummary(
        { gameId, status: 'generating', modelId, perAgent: [], overall: '' },
        this.clock.now(),
      );

      const view = this.games.getHumanView(gameId);
      const input = view ? buildReviewInput(view) : null;
      if (!input) {
        this.games.upsertReviewSummary(
          {
            gameId,
            status: 'failed',
            modelId,
            errorCode: 'NOT_REVIEWABLE',
            perAgent: [],
            overall: '',
          },
          this.clock.now(),
        );
        return;
      }

      const lifecycle: { validatedAttemptId?: string } = {};
      const generation = await policy.generate(input, {
        commandId: `review/${gameId}`,
        actionId: `review/${gameId}`,
        lifecycle,
      });
      const attemptId = lifecycle.validatedAttemptId;
      if (attemptId) this.observability?.markAttemptStage?.(attemptId, 'content_validated');
      try {
        this.games.upsertReviewSummary(
          {
            gameId,
            status: 'done',
            modelId,
            generatedAt: this.clock.now(),
            perAgent: generation.perAgent,
            overall: generation.overall,
          },
          this.clock.now(),
        );
        if (attemptId) {
          this.observability?.markAttemptStage?.(attemptId, 'action_committed');
          this.observability?.finalizeAttempt?.(attemptId, 'action_committed');
        }
      } catch (error) {
        if (attemptId) this.observability?.finalizeAttempt?.(attemptId, 'commit_failed');
        throw error;
      }
    } catch (error) {
      if (error instanceof ReviewRuntimeInterruptedError) {
        this.games.upsertReviewSummary(
          { gameId, status: 'pending', modelId, perAgent: [], overall: '' },
          this.clock.now(),
        );
        return;
      }
      this.games.upsertReviewSummary(
        {
          gameId,
          status: 'failed',
          modelId,
          errorCode: classifyReviewError(error),
          perAgent: [],
          overall: '',
        },
        this.clock.now(),
      );
    } finally {
      this.runningGameId = null;
      this.runningPromise = null;
      this.kick();
    }
  }

  private enqueueFirst(gameId: string) {
    this.removeQueued(gameId);
    this.queue.unshift(gameId);
  }

  private enqueueLast(gameId: string) {
    if (this.runningGameId === gameId || this.queue.includes(gameId)) return;
    this.queue.push(gameId);
  }

  private removeQueued(gameId: string) {
    const index = this.queue.indexOf(gameId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private resolveModelId(): string {
    try {
      return this.policyFactory().modelId;
    } catch {
      return 'unknown';
    }
  }

  private pendingSummary(gameId: string, modelId: string): ReviewSummary {
    return { gameId, status: 'pending', modelId, perAgent: [], overall: '' };
  }
}

function classifyReviewError(error: unknown): ReviewErrorCode {
  if (error instanceof ReviewSystemError) return error.code;
  return 'INTERNAL_ERROR';
}
