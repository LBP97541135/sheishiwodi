// 零成本 agent 输入构造：用 shared 纯函数造一局“已开始”的快照（无 DB / 无网络），
// 再用服务端 projectAgentTurnInput 做白名单投影，得到 describe / vote 两类真实输入。
// 移植自 agent-runtime.test.ts:34-63 的 createAgentTurn，改为可按角色选取行动者。

import {
  createPreparingGame,
  startPreparingGame,
  type AgentTurnInput,
  type Clock,
  type GameSnapshot,
  type IdSource,
  type RandomSource,
  type WordPair,
} from '@sheishiwodi/shared';

import { projectAgentTurnInput } from '../../../apps/server/src/agents/agent-input-projector.js';

type SnapshotPlayer = GameSnapshot['players'][number];

class SeqIds implements IdSource {
  private value = 0;
  nextId(kind: 'game' | 'player' | 'event') {
    this.value += 1;
    return `${kind}-${this.value}`;
  }
}

const clock: Clock = { now: () => '2026-08-16T12:00:00.000Z' };
const random: RandomSource = { next: () => 0 };

const DEFAULT_PAIR: WordPair = {
  id: 'live-pair',
  civilianWord: '牛奶',
  undercoverWord: '豆浆',
  category: '饮品',
  difficulty: 'easy',
  enabled: true,
};

/** 造一局已开始的确定性快照。round 处于描述阶段，可再改 actionType 得投票输入。 */
export function buildStartedSnapshot(pair: WordPair = DEFAULT_PAIR): GameSnapshot {
  const ids = new SeqIds();
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
  return started.snapshot;
}

/** 快照中的全部 AI 玩家。 */
export function agentPlayers(snapshot: GameSnapshot): SnapshotPlayer[] {
  return snapshot.players.filter((player) => player.kind === 'agent');
}

/** 优先返回 agentRoleId 匹配的 AI 玩家，否则回退到第一个 AI 玩家。 */
export function pickAgentForRole(snapshot: GameSnapshot, roleId: string): SnapshotPlayer {
  const agents = agentPlayers(snapshot);
  return agents.find((player) => player.agentRoleId === roleId) ?? agents[0]!;
}

/** 本局出现的全部词牌明文（去重）。用于公开帧的词牌隔离哨兵。 */
export function allWordCards(snapshot: GameSnapshot): string[] {
  return [...new Set(snapshot.players.map((player) => player.wordCard))];
}

/** 除行动者自己以外的词牌明文。用于 agent 输入通道（自己的词牌允许出现）。 */
export function otherWordCards(snapshot: GameSnapshot, actorId: string): string[] {
  const own = snapshot.players.find((player) => player.playerId === actorId)?.wordCard;
  return allWordCards(snapshot).filter((word) => word !== own);
}

/** 描述输入：round.actionType='describe'，currentActorId=行动者。 */
export function buildDescribeInput(snapshot: GameSnapshot, actorId: string): AgentTurnInput {
  const shaped: GameSnapshot = {
    ...snapshot,
    round: { ...snapshot.round!, actionType: 'describe', currentActorId: actorId },
  };
  return projectAgentTurnInput(shaped, actorId, [], []);
}

/** 投票输入：phase='voting'，round.actionType='vote'，currentActorId=行动者。 */
export function buildVoteInput(snapshot: GameSnapshot, actorId: string): AgentTurnInput {
  const shaped: GameSnapshot = {
    ...snapshot,
    phase: 'voting',
    round: { ...snapshot.round!, actionType: 'vote', currentActorId: actorId },
  };
  return projectAgentTurnInput(shaped, actorId, [], []);
}
