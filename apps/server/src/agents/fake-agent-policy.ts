import {
  speechActionOutputSchema,
  validateBeliefSnapshot,
  voteActionOutputSchema,
  type AgentTurnInput,
  type BeliefSnapshot,
  type SpeechActionOutput,
  type VoteActionOutput,
} from '@sheishiwodi/shared';

import type { AgentPolicy } from './agent-policy.js';

const descriptions = ['常见又日常', '经常会接触到', '和生活关系密切', '用途比较明确'];

export type FakeAgentScenario = 'normal' | 'tie-then-eliminate';

export class FakeAgentPolicy implements AgentPolicy {
  readonly receivedInputs: AgentTurnInput[] = [];
  private readonly beliefHistory = new Map<string, BeliefSnapshot[]>();

  constructor(private readonly scenario: FakeAgentScenario = 'normal') {}

  async act(input: AgentTurnInput): Promise<SpeechActionOutput | VoteActionOutput> {
    this.receivedInputs.push(structuredClone(input));
    const belief = this.createBelief(input);
    this.beliefHistory.set(input.actor.playerId, [
      ...(this.beliefHistory.get(input.actor.playerId) ?? []),
      belief,
    ]);

    if (input.actionType === 'describe' || input.actionType === 'defend') {
      const seat = input.players.find((player) => player.playerId === input.actor.playerId)?.seatIndex ?? 0;
      return speechActionOutputSchema.parse({
        belief,
        text:
          input.actionType === 'defend'
            ? `我的线索保持一致${seat + 1}`
            : descriptions[seat % descriptions.length],
      });
    }

    if (input.actionType === 'vote' || input.actionType === 'revote') {
      const targetPlayerId = this.voteTarget(input);
      if (!targetPlayerId) throw new Error('NO_LEGAL_TARGET');
      return voteActionOutputSchema.parse({
        belief,
        targetPlayerId,
        reason:
          input.actionType === 'revote'
            ? '根据候选辩解选择首个合法重投目标'
            : '根据当前公开描述选择首个合法目标',
      });
    }

    throw new Error('UNSUPPORTED_FAKE_ACTION');
  }

  priorBeliefs(playerId: string) {
    return this.beliefHistory.get(playerId) ?? [];
  }

  private voteTarget(input: AgentTurnInput) {
    if (this.scenario !== 'tie-then-eliminate') return input.legalTargets[0];
    const living = input.players.filter((player) => player.alive).sort((a, b) => a.seatIndex - b.seatIndex);
    if (input.actionType === 'revote') return input.tieCandidates[0];
    if (input.roundNumber === 1 && input.actionType === 'vote') {
      const firstAgentId = living.find((player) => player.playerId !== input.actor.playerId)?.playerId;
      const firstAgent = living.find((player) => player.seatIndex === 1);
      const secondAgent = living.find((player) => player.seatIndex === 2);
      const actorSeat = living.find((player) => player.playerId === input.actor.playerId)?.seatIndex ?? 0;
      if (firstAgent && secondAgent) {
        return actorSeat % 2 === 0 ? firstAgent.playerId : secondAgent.playerId;
      }
      return firstAgentId;
    }
    return input.legalTargets[0];
  }

  private createBelief(input: AgentTurnInput) {
    const living = input.players.filter((player) => player.alive);
    const probability = input.publicConfig.undercoverCount / living.length;
    return validateBeliefSnapshot(
      {
        opposingWordCandidates: [
          { word: '未知词', confidence: 0.2, evidence: '当前公开信息仍然有限' },
        ],
        playerUndercoverProbabilities: living.map((player) => ({
          playerId: player.playerId,
          probability,
        })),
        reasoningSummary: '假模型按公开信息生成确定性均匀信念',
      },
      living.map((player) => player.playerId),
      input.publicConfig.undercoverCount,
    );
  }
}
