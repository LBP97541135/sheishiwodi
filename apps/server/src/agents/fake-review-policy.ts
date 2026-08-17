import {
  reviewGenerationSchema,
  type ReviewGeneration,
  type ReviewPerAgent,
} from '@sheishiwodi/shared';

import type { ReviewInput, ReviewPolicy } from './review-policy.js';

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
      const keyMoments = actions.slice(0, 4).map((action) => {
        if (action.actionType === 'describe' || action.actionType === 'defend') {
          const text = typeof action.output['text'] === 'string' ? action.output['text'] : '';
          const label = action.actionType === 'defend' ? '辩解' : '描述';
          return `第${action.roundNumber}轮${label}：${text}`;
        }
        const targetId =
          typeof action.output['targetPlayerId'] === 'string'
            ? action.output['targetPlayerId']
            : '';
        return `第${action.roundNumber}轮投给 ${nameOf.get(targetId) ?? '未知'}`;
      });
      return {
        playerId: player.playerId,
        verdict: `${player.displayName}（${camp}）共行动 ${actions.length} 次、投票 ${votes.length} 次，信念与公开发言保持一致。`,
        keyMoments,
        rating: 3,
      };
    });

    const winner = input.winnerCamp === 'civilian' ? '平民阵营' : '卧底阵营';
    const overall = `本局由${winner}获胜（${input.endReason}）。公开时间线共 ${input.publicTimeline.length} 条事件，AI 私有行动 ${input.factReview.agentActions.length} 条。这是离线假复盘，用于占位与测试。`;

    return reviewGenerationSchema.parse({ perAgent, overall });
  }
}
