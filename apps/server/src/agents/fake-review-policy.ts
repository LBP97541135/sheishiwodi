import {
  reviewGenerationSchema,
  type ReviewGeneration,
  type ReviewPerAgent,
} from '@sheishiwodi/shared';

import {
  buildGuessDecisionFrames,
  type ReviewInput,
  type ReviewPolicy,
} from './review-policy.js';

/**
 * 确定性离线复盘策略：不联网、不读密钥，供默认测试与未配置真实 provider 时使用。
 * 仅根据终局事实（阵营、词牌、投票、信念）拼装稳定文本，便于断言。
 */
export class FakeReviewPolicy implements ReviewPolicy {
  readonly modelId: string;

  constructor(modelId = 'fake-review') {
    this.modelId = modelId;
  }

  async generate(input: ReviewInput): Promise<ReviewGeneration> {
    const revealByPlayer = new Map(input.reveal.players.map((entry) => [entry.playerId, entry]));
    const nameOf = new Map(input.players.map((player) => [player.playerId, player.displayName]));

    const agentPlayers = input.players.filter((player) => player.kind === 'agent');
    const perAgent: ReviewPerAgent[] = agentPlayers.map((player) => {
      const reveal = revealByPlayer.get(player.playerId);
      const camp = reveal?.camp === 'undercover' ? '卧底' : '平民';
      const actions = input.factReview.agentActions.filter(
        (action) => action.playerId === player.playerId,
      );
      const votes = actions.filter(
        (action) => action.actionType === 'vote' || action.actionType === 'revote',
      );
      const keyMoments = actions.slice(0, 2).map((action) => {
        if (action.actionType === 'describe' || action.actionType === 'defend') {
          const text = typeof action.output['text'] === 'string' ? action.output['text'] : '';
          const label = action.actionType === 'defend' ? '辩解' : '描述';
          return truncate(`第${action.roundNumber}轮${label}：${text}`, 50);
        }
        const targetId =
          typeof action.output['targetPlayerId'] === 'string'
            ? action.output['targetPlayerId']
            : '';
        return truncate(`第${action.roundNumber}轮投给 ${nameOf.get(targetId) ?? '未知'}`, 50);
      });
      return {
        playerId: player.playerId,
        verdict: fitText(
          `${player.displayName}（${camp}）共行动 ${actions.length} 次、投票 ${votes.length} 次，信念与公开发言保持一致；可以继续根据每轮新增证据及时调整怀疑和行动。`,
          60,
          100,
        ),
        keyMoments: keyMoments.length > 0 ? keyMoments : ['全局｜缺少可评价的私有行动记录'],
        rating: 3,
      };
    });

    const winner = input.winnerCamp === 'draw' ? '平局' : input.winnerCamp === 'civilian' ? '平民阵营' : '卧底阵营';
    const overall = fitText(
      `本局由${winner}获胜（${input.endReason}）。公开时间线共 ${input.publicTimeline.length} 条事件，AI 私有行动 ${input.factReview.agentActions.length} 条。离线复盘只用于验证确定性事实、展示结构和恢复流程；真实评价仍由显式配置的复盘模型生成。`,
      100,
      160,
    );

    const guessFrames = buildGuessDecisionFrames(input).filter(
      (frame) => frame.decisionType === 'attempt',
    );
    const guessAnalysis = input.gameMode === 'guess'
      ? {
          summary:
            guessFrames.length > 0
              ? `本局 AI 共发起 ${guessFrames.length} 次猜词；离线策略仅按行动时信念验证展示结构，不替代真实复盘模型的策略判断。`
              : '本局 AI 没有发起猜词；离线策略不臆造错失机会，真实策略判断由配置的复盘模型生成。',
          keyDecisions: guessFrames.slice(0, 3).map((frame) => {
            const confidence = Math.max(
              0,
              ...frame.beliefAtAction.opposingWordCandidates.map((entry) => entry.confidence),
            );
            return {
              actionId: frame.actionId,
              actorId: frame.actorId,
              roundNumber: frame.roundNumber,
              phase: frame.phase,
              kind: 'attempt' as const,
              verdict: confidence >= 0.65 ? 'reasonable' as const : 'insufficient_basis' as const,
              assessment: `行动时最高词语置信度为 ${Math.round(confidence * 100)}%，离线复盘仅据该结构化信念判断决策依据。`,
              outcomeImpact: frame.outcome
                ? `${frame.outcome.success ? '猜词成功' : '猜词失败'}，对应玩家按规则出局。`
                : '缺少可关联的猜词结算记录。',
            };
          }),
        }
      : undefined;

    return reviewGenerationSchema.parse({
      perAgent,
      overall,
      ...(guessAnalysis ? { guessAnalysis, guessAnalysisStatus: 'done' as const } : {}),
    });
  }
}

function truncate(value: string, maxLength: number) {
  return value.trim().slice(0, maxLength);
}

function fitText(value: string, minLength: number, maxLength: number) {
  const truncated = truncate(value, maxLength);
  return truncated.length >= minLength
    ? truncated
    : `${truncated}${'。'.repeat(minLength - truncated.length)}`;
}
