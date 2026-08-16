import { describe, expect, it } from 'vitest';

import {
  createPreparingGame,
  startPreparingGame,
  type Clock,
  type IdSource,
  type RandomSource,
  type WordPair,
} from '@sheishiwodi/shared';

import { projectAgentTurnInput } from './agent-input-projector.js';
import { FakeAgentPolicy } from './fake-agent-policy.js';

class Ids implements IdSource {
  private value = 0;
  nextId(kind: 'game' | 'player' | 'event') {
    this.value += 1;
    return `${kind}-${this.value}`;
  }
}

const clock: Clock = { now: () => '2026-08-16T12:00:00.000Z' };
const random: RandomSource = { next: () => 0 };
const pair: WordPair = {
  id: 'pair',
  civilianWord: '牛奶',
  undercoverWord: '豆浆',
  category: '饮品',
  difficulty: 'easy',
  enabled: true,
};

function createAgentTurn() {
  const ids = new Ids();
  const created = createPreparingGame(
    {
      type: 'CreateGame',
      commandId: 'create',
      human: { displayName: '玩家', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
    [pair],
    { ids, clock, random },
  );
  const started = startPreparingGame(
    created.snapshot,
    {
      type: 'StartGame',
      commandId: 'start',
      gameId: created.snapshot.gameId,
      actorId: created.snapshot.humanPlayerId,
      expectedRevision: 0,
    },
    { ids, clock },
  );
  const agent = started.snapshot.players.find((player) => player.kind === 'agent')!;
  const snapshot = {
    ...started.snapshot,
    round: { ...started.snapshot.round!, currentActorId: agent.playerId },
  };
  return { snapshot, agent };
}

describe('Agent 输入投影', () => {
  it('只包含自己的词牌和公开白名单', () => {
    const { snapshot, agent } = createAgentTurn();
    const input = projectAgentTurnInput(snapshot, agent.playerId, [], []);
    const serialized = JSON.stringify(input);

    expect(input.actor.ownWordCard).toBe(agent.wordCard);
    for (const other of snapshot.players.filter(
      (player) => player.playerId !== agent.playerId && player.wordCard !== agent.wordCard,
    )) {
      expect(serialized).not.toContain(other.wordCard);
    }
    expect(serialized).not.toContain('"camp"');
    expect(serialized).not.toContain('civilianWord');
    expect(serialized).not.toContain('undercoverWord');
  });

  it('普通投票输入只含公开历史，不含其他未揭晓选票或理由', () => {
    const { snapshot, agent } = createAgentTurn();
    const voting = {
      ...snapshot,
      phase: 'voting' as const,
      round: {
        ...snapshot.round!,
        actionType: 'vote' as const,
        currentActorId: agent.playerId,
        completedVoterIds: [snapshot.humanPlayerId],
        votes: [{ voterId: snapshot.humanPlayerId, targetPlayerId: agent.playerId }],
      },
    };
    const input = projectAgentTurnInput(voting, agent.playerId, [], []);
    const serialized = JSON.stringify(input);

    expect(input.legalTargets).not.toContain(agent.playerId);
    expect(serialized).not.toContain('targetPlayerId');
    expect(serialized).not.toContain('vote_cast');
    expect(serialized).not.toContain('reason');
    expect(serialized).not.toContain('probability');
  });

  it('辩解不提供投票目标，重投只提供平票候选', () => {
    const { snapshot } = createAgentTurn();
    const agents = snapshot.players.filter((player) => player.kind === 'agent');
    const defender = agents[0]!;
    const candidates = [defender.playerId, snapshot.humanPlayerId];
    const defending = {
      ...snapshot,
      phase: 'tie_defense' as const,
      round: {
        ...snapshot.round!,
        actionType: 'defend' as const,
        currentActorId: defender.playerId,
        tieCandidateIds: candidates,
      },
    };
    const defenseInput = projectAgentTurnInput(defending, defender.playerId, [], []);
    expect(defenseInput.legalTargets).toEqual([]);
    expect(defenseInput.tieCandidates).toEqual(candidates);

    const revoter = agents[1]!;
    const revoting = {
      ...snapshot,
      phase: 'revoting' as const,
      round: {
        ...snapshot.round!,
        actionType: 'revote' as const,
        currentActorId: revoter.playerId,
        tieCandidateIds: candidates,
      },
    };
    const revoteInput = projectAgentTurnInput(revoting, revoter.playerId, [], []);
    expect(revoteInput.legalTargets).toEqual(candidates);
    expect(revoteInput.tieCandidates).toEqual(candidates);
    const serialized = JSON.stringify(revoteInput);
    expect(serialized).not.toContain('"camp"');
    expect(serialized).not.toContain('vote_cast');
    expect(serialized).not.toContain('targetPlayerId');
  });
});

describe('FakeAgentPolicy', () => {
  it('确定性生成合法描述并记录输入', () => {
    const { snapshot, agent } = createAgentTurn();
    const input = projectAgentTurnInput(snapshot, agent.playerId, [], []);
    const policy = new FakeAgentPolicy();
    const output = policy.act(input);

    expect(output).toHaveProperty('text');
    expect(policy.receivedInputs).toEqual([input]);
    expect(policy.priorBeliefs(agent.playerId)).toHaveLength(1);
  });

  it('确定性生成合法辩解和候选范围内的重投', () => {
    const { snapshot } = createAgentTurn();
    const agents = snapshot.players.filter((player) => player.kind === 'agent');
    const defender = agents[0]!;
    const candidates = [defender.playerId, snapshot.humanPlayerId];
    const policy = new FakeAgentPolicy();
    const defenseInput = projectAgentTurnInput(
      {
        ...snapshot,
        phase: 'tie_defense',
        round: {
          ...snapshot.round!,
          actionType: 'defend',
          currentActorId: defender.playerId,
          tieCandidateIds: candidates,
        },
      },
      defender.playerId,
      [],
      [],
    );
    const defense = policy.act(defenseInput);
    expect(defense).toHaveProperty('text');

    const revoter = agents[1]!;
    const revoteInput = projectAgentTurnInput(
      {
        ...snapshot,
        phase: 'revoting',
        round: {
          ...snapshot.round!,
          actionType: 'revote',
          currentActorId: revoter.playerId,
          tieCandidateIds: candidates,
        },
      },
      revoter.playerId,
      [],
      policy.priorBeliefs(revoter.playerId),
    );
    const revote = policy.act(revoteInput);
    expect(revote).toMatchObject({ targetPlayerId: candidates[0] });
    expect(candidates).toContain((revote as { targetPlayerId: string }).targetPlayerId);
  });
});
