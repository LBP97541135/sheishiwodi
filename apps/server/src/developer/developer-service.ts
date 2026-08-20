import type {
  DeveloperFullRecordDetail,
  DeveloperFullRecordSummary,
  DeveloperOverview,
} from '@sheishiwodi/shared';

import type { ContextAuditWriter } from '../agents/agent-observability.js';
import type { ProviderCircuitBreakerPort } from '../agents/provider-circuit-breaker.js';
import type { ModelAttemptRepository } from '../db/model-attempt-repository.js';
import type { GameRecoveryRepository } from '../games/game-recovery-repository.js';
import type { ReviewService } from '../games/review-service.js';

export class DeveloperService {
  constructor(
    private readonly attempts: ModelAttemptRepository,
    private readonly audit: ContextAuditWriter,
    private readonly recovery: GameRecoveryRepository,
    private readonly circuitBreaker: ProviderCircuitBreakerPort,
    private readonly review: ReviewService,
  ) {}

  overview(gameId?: string): DeveloperOverview {
    const calls = this.attempts.listRecent(gameId, 100);
    return {
      fullRecordingEnabled: this.audit.isFullRecordingEnabled(),
      calls,
      contexts: this.audit.listManifests(gameId).slice(0, 100).map((manifest) => ({
        attemptId: manifest.attemptId,
        gameId: manifest.gameId,
        actionId: manifest.actionId,
        roleId: manifest.roleId,
        actionType: manifest.actionType,
        publicEventCursor: manifest.publicEventCursor,
        templateVersion: manifest.templateVersion,
        promptHash: manifest.promptHash,
        sources: manifest.sources,
        validationStatus: manifest.validation.status,
        validationChecks: manifest.validation.checks,
        createdAt: manifest.createdAt,
      })),
      errorsAndRecovery: {
        failedAttempts: calls.filter(
          (attempt) =>
            !['action_committed', 'success', 'started', 'schema_validated'].includes(
              attempt.resultCode,
            ),
        ),
        interruptedGames: this.recovery
          .listAwaiting()
          .filter((entry) => !gameId || entry.gameId === gameId),
        providerCircuit: this.circuitBreaker.snapshot(),
      },
      review: this.review.snapshot(),
    };
  }

  setFullRecording(enabled: boolean) {
    this.audit.setFullRecordingEnabled(enabled);
    return { enabled };
  }

  listFullRecords(gameId?: string): DeveloperFullRecordSummary[] {
    return this.audit.listFullRecords(gameId).map(toSummary);
  }

  getFullRecord(attemptId: string): DeveloperFullRecordDetail | null {
    const record = this.audit.getFullRecord(attemptId);
    return record ? { ...toSummary(record), prompt: record.prompt, ...(record.rawResponse === undefined ? {} : { rawResponse: record.rawResponse }) } : null;
  }

  clearFullRecords() {
    this.audit.clearFullRecords();
    return { cleared: true as const };
  }
}

function toSummary(record: ReturnType<ContextAuditWriter['listFullRecords']>[number]) {
  return {
    attemptId: record.attemptId,
    gameId: record.gameId,
    actionType: record.actionType,
    createdAt: record.createdAt,
    ...(record.resultCode ? { resultCode: record.resultCode } : {}),
    hasPrompt: record.prompt.length > 0,
    hasResponse: record.rawResponse !== undefined,
  };
}
