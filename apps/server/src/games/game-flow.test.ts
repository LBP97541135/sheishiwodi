import { describe, expect, it } from 'vitest';

import {
  validateBeliefSnapshot,
  type AgentTurnInput,
  type BeliefSnapshot,
  type SpeechActionOutput,
  type VoteActionOutput,
} from '@sheishiwodi/shared';

import type { FastifyInstance } from 'fastify';

import { buildServer, type ServerDependencies } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';
import type { AgentActContext, AgentPolicy } from '../agents/agent-policy.js';

const GENERIC_DESCRIBE = '这是一个很普通的东西';

interface FinalePlayer {
  playerId: string;
  seatIndex: number;
  camp: string;
  wordCard: string;
}

interface FinaleAgentAction {
  actionId: string;
  playerId: string;
  roundNumber: number;
  actionType: string;
  baseRevision: number;
  belief: BeliefSnapshot;
  output: Record<string, unknown>;
  completedAt: string;
}

interface HumanView {
  gameId: string;
  status: string;
  phase: string;
  revision: number;
  round: {
    number: number;
    currentActorId: string | null;
    actionType: string | null;
    tieCandidateIds: string[];
  } | null;
  legalVoteTargetIds: string[];
  allowedCommands?: string[];
  players: Array<{ playerId: string; alive: boolean }>;
  human: { playerId: string; ownWordCard: string };
  winnerCamp?: string;
  endReason?: string;
  reveal?: {
    wordPair: { civilianWord: string; undercoverWord: string; category: string };
    players: FinalePlayer[];
  };
  factReview?: { agentActions: FinaleAgentAction[] };
}

const createGame = async (server: FastifyInstance) => {
  const response = await server.inject({
    method: 'POST',
    url: '/api/games',
    payload: {
      commandId: 'create-1',
      human: { displayName: '小祎', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
  });
  const view = (response.json() as { data: HumanView }).data;
  await server.inject({
    method: 'POST',
    url: `/api/games/${view.gameId}/start`,
    payload: { commandId: 'start-1', actorId: view.human.playerId, expectedRevision: view.revision },
  });
  return view;
};

const getView = async (server: FastifyInstance, gameId: string) =>
  (await server.inject({ method: 'GET', url: `/api/games/${gameId}` })).json() as { data: HumanView };

const submitHumanDescriptionAndVote = async (
  server: FastifyInstance,
  gameId: string,
  humanId: string,
  targetPlayerId: string,
  suffix: string,
) => {
  const describing = (await getView(server, gameId)).data;
  const described = await server.inject({
    method: 'POST',
    url: `/api/games/${gameId}/descriptions`,
    payload: {
      commandId: `human-describe-${suffix}`,
      actorId: humanId,
      expectedRevision: describing.revision,
      text: GENERIC_DESCRIBE,
    },
  });
  if (described.statusCode !== 200) throw new Error(described.body);
  const voting = (described.json() as { data: HumanView }).data;
  return server.inject({
    method: 'POST',
    url: `/api/games/${gameId}/votes`,
    payload: {
      commandId: `human-vote-${suffix}`,
      actorId: humanId,
      expectedRevision: voting.revision,
      targetPlayerId,
    },
  });
};

const driveHumanToEnd = async (server: FastifyInstance, gameId: string, humanId: string) => {
  for (let step = 0; step < 60; step += 1) {
    const { data: view } = await getView(server, gameId);
    if (view.status === 'awaiting_spectator') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/spectate`,
        payload: {
          commandId: `human-spectate-${step}`,
          actorId: humanId,
          expectedRevision: view.revision,
        },
      });
      continue;
    }
    if (view.status !== 'in_progress') {
      return view;
    }
    if (view.round?.currentActorId !== humanId) {
      return view;
    }
    if (view.round.actionType === 'describe') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/descriptions`,
        payload: {
          commandId: `human-describe-${step}`,
          actorId: humanId,
          expectedRevision: view.revision,
          text: GENERIC_DESCRIBE,
        },
      });
    } else if (view.round.actionType === 'vote') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/votes`,
        payload: {
          commandId: `human-vote-${step}`,
          actorId: humanId,
          expectedRevision: view.revision,
          targetPlayerId: view.legalVoteTargetIds[0],
        },
      });
    }
  }
  throw new Error('对局没有在限定步数内结束');
};

const readEvents = async (server: FastifyInstance, gameId: string) =>
  (await server.inject({ method: 'GET', url: `/api/games/${gameId}/events?after=0` })).json() as {
    data: { frames: Array<{ type: string; payload: Record<string, unknown> }>; eventCursor: number };
  };

const readPlayers = (dependencies: ServerDependencies, gameId: string) =>
  dependencies.database.sqlite
    .prepare('SELECT player_id, seat_index, camp, word_card FROM game_players WHERE game_id = ? ORDER BY seat_index')
    .all(gameId) as Array<{ player_id: string; seat_index: number; camp: string; word_card: string }>;

describe('切片六 主动放弃', () => {
  it('准备阶段放弃保留事实且无胜者，并允许创建新对局', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);
    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-abandon-preparing',
        human: { displayName: '小祎', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const created = (createdResponse.json() as { data: HumanView }).data;
    const abandoned = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/abandon`,
      payload: {
        commandId: 'abandon-preparing',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
        confirmed: true,
      },
    });
    expect(abandoned.statusCode).toBe(200);
    const view = (abandoned.json() as { data: HumanView }).data;
    expect(view.status).toBe('abandoned');
    expect(view.phase).toBe('ended');
    expect(view.endReason).toBe('abandoned_by_human');
    expect(view).not.toHaveProperty('winnerCamp');
    expect(view).not.toHaveProperty('reveal');
    expect(view).not.toHaveProperty('factReview');
    expect(view.allowedCommands).toEqual([]);

    const events = await readEvents(server, created.gameId);
    expect(events.data.frames).toContainEqual(
      expect.objectContaining({ type: 'game_abandoned', payload: { playerId: created.human.playerId } }),
    );
    const next = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-after-abandon',
        human: { displayName: '新玩家', silhouette: 'silhouette_b' },
        difficulty: 'easy',
      },
    });
    expect(next.statusCode).toBe(201);

    await server.close();
    environment.cleanup();
  });

  it('进行中放弃命令幂等，不新增重复事件且无私有字段', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    const active = (await getView(server, created.gameId)).data;
    const payload = {
      commandId: 'abandon-active',
      actorId: created.human.playerId,
      expectedRevision: active.revision,
      confirmed: true,
    };
    const first = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/abandon`,
      payload,
    });
    const repeated = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/abandon`,
      payload,
    });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual(first.json());
    const view = (first.json() as { data: HumanView }).data;
    expect(view.status).toBe('abandoned');
    expect(view).not.toHaveProperty('winnerCamp');
    expect(view).not.toHaveProperty('reveal');
    expect(view).not.toHaveProperty('factReview');
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain('"camp"');
    expect(serialized).not.toContain('reasoningSummary');

    const count = environment.dependencies.database.sqlite
      .prepare("SELECT COUNT(*) AS value FROM game_events WHERE game_id = ? AND type = 'game_abandoned'")
      .get(created.gameId) as { value: number };
    expect(count.value).toBe(1);

    await server.close();
    environment.cleanup();
  });

  it('未确认或过期放弃请求被拒绝且不改变活动局', async () => {
    const environment = createTestEnvironment();
    const server = buildServer(environment.dependencies);
    const createdResponse = await server.inject({
      method: 'POST',
      url: '/api/games',
      payload: {
        commandId: 'create-abandon-reject',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
    });
    const created = (createdResponse.json() as { data: HumanView }).data;
    const unconfirmed = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/abandon`,
      payload: {
        commandId: 'abandon-unconfirmed',
        actorId: created.human.playerId,
        expectedRevision: created.revision,
        confirmed: false,
      },
    });
    expect(unconfirmed.statusCode).toBe(400);
    const stale = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/abandon`,
      payload: {
        commandId: 'abandon-stale',
        actorId: created.human.playerId,
        expectedRevision: created.revision + 1,
        confirmed: true,
      },
    });
    expect(stale.statusCode).toBe(409);
    expect((await getView(server, created.gameId)).data.status).toBe('preparing');

    await server.close();
    environment.cleanup();
  });
});

describe('切片三 正常描述与投票闭环', () => {
  it('人类被卧底身份淘汰后判定平民胜利，全程不泄露私有字段', async () => {
    // 种子 [0,0,...] 使 0 号座位（人类）成为卧底，第一轮即被票出。
    const environment = createTestEnvironment([0, 0, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    const final = await driveHumanToEnd(server, created.gameId, created.human.playerId);

    expect(final.status).toBe('finished');
    expect(final.winnerCamp).toBe('civilian');
    expect(final.endReason).toBe('undercover_eliminated');
    expect(final.reveal?.players).toEqual(
      readPlayers(environment.dependencies, created.gameId)
        .map((player) => ({
          playerId: player.player_id,
          seatIndex: player.seat_index,
          camp: player.camp,
          wordCard: player.word_card,
        }))
        .sort((left, right) => left.seatIndex - right.seatIndex),
    );
    expect(final.factReview?.agentActions.length).toBeGreaterThan(0);
    const agentActions = final.factReview!.agentActions;
    expect(agentActions).toEqual(
      [...agentActions].sort(
        (left, right) => left.roundNumber - right.roundNumber || left.baseRevision - right.baseRevision,
      ),
    );

    const refresh = (await getView(server, created.gameId)).data;
    expect(refresh.reveal).toEqual(final.reveal);
    expect(refresh.factReview).toEqual(final.factReview);
    const events = await readEvents(server, created.gameId);
    expect(events.data.frames.filter((frame) => frame.type === 'terminal_reveal_ready')).toHaveLength(1);

    await assertPublicIsolation(server, environment.dependencies, created.gameId);

    await server.close();
    environment.cleanup();
  });

  it('卧底存活至两人时判定卧底胜利', async () => {
    // 种子 [0,0.76,...] 使 3 号座位（AI 千问）成为卧底，人类先被淘汰后 AI 自动跑到卧底胜利。
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    const final = await driveHumanToEnd(server, created.gameId, created.human.playerId);

    expect(final.status).toBe('finished');
    expect(final.winnerCamp).toBe('undercover');
    expect(final.endReason).toBe('undercover_survived_to_two');

    await assertPublicIsolation(server, environment.dependencies, created.gameId);

    await server.close();
    environment.cleanup();
  });

  it('轮到人类时暂停，合法描述后继续自动推进', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);

    const paused = (await getView(server, created.gameId)).data;
    expect(paused.status).toBe('in_progress');
    expect(paused.round?.currentActorId).toBe(created.human.playerId);
    expect(paused.round?.actionType).toBe('describe');

    const submitted = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/descriptions`,
      payload: {
        commandId: 'human-describe-1',
        actorId: created.human.playerId,
        expectedRevision: paused.revision,
        text: GENERIC_DESCRIBE,
      },
    });
    expect(submitted.statusCode).toBe(200);
    const afterDescribe = (submitted.json() as { data: HumanView }).data;
    // 描述完成后自动推进到人类投票（其余描述者均为 AI，已被服务端自动执行）。
    expect(afterDescribe.revision).toBeGreaterThan(paused.revision);
    expect(afterDescribe.round?.currentActorId).toBe(created.human.playerId);
    expect(afterDescribe.round?.actionType).toBe('vote');

    await server.close();
    environment.cleanup();
  });

  it('单票只公开完成进度，最后一票才统一揭晓且仅一次', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    await driveHumanToEnd(server, created.gameId, created.human.playerId);

    const { data } = await readEvents(server, created.gameId);
    const progressFrames = data.frames.filter((frame) => frame.type === 'vote_progressed');
    const revealFrames = data.frames.filter((frame) => frame.type === 'votes_revealed');

    expect(progressFrames.length).toBeGreaterThan(0);
    for (const frame of progressFrames) {
      expect(frame.payload).toHaveProperty('playerId');
      expect(frame.payload).not.toHaveProperty('targetPlayerId');
      expect(frame.payload).not.toHaveProperty('reason');
      expect(frame.payload).not.toHaveProperty('probability');
      expect(frame.payload).not.toHaveProperty('opposingWordCandidates');
    }
    // 每完成一轮投票只允许一个统一揭晓帧。
    expect(revealFrames.length).toBeGreaterThanOrEqual(1);
    for (const frame of revealFrames) {
      expect(Array.isArray(frame.payload['votes'])).toBe(true);
    }

    await server.close();
    environment.cleanup();
  });

  it('人类被淘汰后等待选择，继续观战自动推进且不新增私有字段', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    let waiting: HumanView | null = null;
    for (let step = 0; step < 30; step += 1) {
      const view = (await getView(server, created.gameId)).data;
      if (view.status === 'awaiting_spectator') {
        waiting = view;
        break;
      }
      if (view.round?.currentActorId !== created.human.playerId) break;
      if (view.round.actionType === 'describe') {
        await server.inject({
          method: 'POST',
          url: `/api/games/${created.gameId}/descriptions`,
          payload: {
            commandId: `spectator-describe-${step}`,
            actorId: created.human.playerId,
            expectedRevision: view.revision,
            text: GENERIC_DESCRIBE,
          },
        });
      } else if (view.round.actionType === 'vote') {
        await server.inject({
          method: 'POST',
          url: `/api/games/${created.gameId}/votes`,
          payload: {
            commandId: `spectator-vote-${step}`,
            actorId: created.human.playerId,
            expectedRevision: view.revision,
            targetPlayerId: view.legalVoteTargetIds[0],
          },
        });
      }
    }
    expect(waiting?.status).toBe('awaiting_spectator');
    expect(waiting?.allowedCommands).toEqual(['ContinueSpectating', 'AbandonGame']);
    expect(waiting?.players.find((player) => player.playerId === created.human.playerId)?.alive).toBe(false);
    const serializedWaiting = JSON.stringify(waiting);
    expect(serializedWaiting).not.toContain('"camp"');
    expect(serializedWaiting).not.toContain('wordCard');
    expect(serializedWaiting).not.toContain('reasoningSummary');
    expect(waiting).not.toHaveProperty('winnerCamp');
    expect(waiting).not.toHaveProperty('reveal');
    expect(waiting).not.toHaveProperty('factReview');

    const continued = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/spectate`,
      payload: {
        commandId: 'continue-spectating-api',
        actorId: created.human.playerId,
        expectedRevision: waiting!.revision,
      },
    });
    expect(continued.statusCode).toBe(200);
    const final = (continued.json() as { data: HumanView }).data;
    expect(final.status).toBe('finished');
    expect(final.allowedCommands).toEqual([]);
    expect(JSON.stringify(final.players)).not.toContain('"camp"');

    const events = await readEvents(server, created.gameId);
    expect(events.data.frames.filter((frame) => frame.type === 'spectating_started')).toHaveLength(1);

    await server.close();
    environment.cleanup();
  });

  it('等待观战时也可放弃且不产生胜者', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    let waiting: HumanView | null = null;
    for (let step = 0; step < 30; step += 1) {
      const view = (await getView(server, created.gameId)).data;
      if (view.status === 'awaiting_spectator') {
        waiting = view;
        break;
      }
      if (view.round?.currentActorId !== created.human.playerId) break;
      const url = view.round.actionType === 'describe' ? 'descriptions' : 'votes';
      const payload =
        view.round.actionType === 'describe'
          ? {
              commandId: `abandon-spectator-describe-${step}`,
              actorId: created.human.playerId,
              expectedRevision: view.revision,
              text: GENERIC_DESCRIBE,
            }
          : {
              commandId: `abandon-spectator-vote-${step}`,
              actorId: created.human.playerId,
              expectedRevision: view.revision,
              targetPlayerId: view.legalVoteTargetIds[0],
            };
      await server.inject({ method: 'POST', url: `/api/games/${created.gameId}/${url}`, payload });
    }
    expect(waiting).not.toBeNull();
    const abandoned = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/abandon`,
      payload: {
        commandId: 'abandon-after-elimination',
        actorId: created.human.playerId,
        expectedRevision: waiting!.revision,
        confirmed: true,
      },
    });
    const view = (abandoned.json() as { data: HumanView }).data;
    expect(view.status).toBe('abandoned');
    expect(view).not.toHaveProperty('winnerCamp');

    await server.close();
    environment.cleanup();
  });

  it('部分平票后 AI 候选自动辩解，并停在人类重投', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const policy = new TiePolicy();
    const server = buildServer({ ...environment.dependencies, agentPolicyFactory: () => policy });
    const created = await createGame(server);
    const describing = (await getView(server, created.gameId)).data;

    const described = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/descriptions`,
      payload: {
        commandId: 'human-describe-tie',
        actorId: created.human.playerId,
        expectedRevision: describing.revision,
        text: GENERIC_DESCRIBE,
      },
    });
    const voting = (described.json() as { data: HumanView }).data;
    const voted = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/votes`,
      payload: {
        commandId: 'human-vote-tie',
        actorId: created.human.playerId,
        expectedRevision: voting.revision,
        targetPlayerId: 'player-3',
      },
    });
    const revoting = (voted.json() as { data: HumanView }).data;

    expect(voted.statusCode, voted.body).toBe(200);
    expect(revoting.status).toBe('in_progress');
    expect(revoting.phase).toBe('revoting');
    expect(revoting.round?.currentActorId).toBe(created.human.playerId);
    expect(revoting.round?.actionType).toBe('revote');
    expect(revoting.legalVoteTargetIds).toEqual(['player-3', 'player-4']);
    expect(policy.actionTypes.filter((type) => type === 'defend')).toEqual(['defend', 'defend']);
    expect(policy.actionTypes.filter((type) => type === 'revote')).toEqual([]);
    const voteCalls = policy.calls.filter((call) => call.actionType === 'vote');
    const persistedVoteActionIds = environment.dependencies.database.sqlite
      .prepare(
        `SELECT action_id FROM agent_actions
         WHERE game_id = ? AND action_type = 'vote' ORDER BY action_id`,
      )
      .all(created.gameId) as Array<{ action_id: string }>;
    expect(voteCalls).toHaveLength(3);
    expect(voteCalls.every((call) => call.context?.trace?.commandId === 'human-vote-tie')).toBe(true);
    expect(voteCalls.map((call) => call.context?.trace?.actionId).sort()).toEqual(
      persistedVoteActionIds.map((row) => row.action_id).sort(),
    );

    const { data } = await readEvents(server, created.gameId);
    const defenseFrames = data.frames.filter(
      (frame) => frame.type === 'speech_published' && frame.payload['actionType'] === 'defend',
    );
    expect(defenseFrames).toHaveLength(2);
    expect(JSON.stringify(data.frames)).not.toContain('reasoningSummary');

    await server.close();
    environment.cleanup();
  });

  it('重投唯一最高票时淘汰候选，公开流不提前泄露重投目标', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const policy = new TiePolicy();
    const server = buildServer({ ...environment.dependencies, agentPolicyFactory: () => policy });
    const created = await createGame(server);
    const tied = await submitHumanDescriptionAndVote(
      server,
      created.gameId,
      created.human.playerId,
      'player-3',
      'revote-eliminate',
    );
    const revoting = (tied.json() as { data: HumanView }).data;

    const revoted = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/votes`,
      payload: {
        commandId: 'human-revote-eliminate',
        actorId: created.human.playerId,
        expectedRevision: revoting.revision,
        targetPlayerId: 'player-3',
      },
    });
    expect(revoted.statusCode, revoted.body).toBe(200);
    const after = (revoted.json() as { data: HumanView }).data;
    expect(after.players.find((player) => player.playerId === 'player-3')?.alive).toBe(false);
    expect(after.phase).not.toBe('revoting');

    const { data } = await readEvents(server, created.gameId);
    const revoteStartIndex = data.frames.findIndex((frame) => frame.type === 'revote_started');
    const revealIndex = data.frames.findIndex(
      (frame, index) => index > revoteStartIndex && frame.type === 'votes_revealed',
    );
    const between = data.frames.slice(revoteStartIndex + 1, revealIndex);
    expect(between.some((frame) => frame.type === 'vote_progressed')).toBe(true);
    expect(JSON.stringify(between)).not.toContain('targetPlayerId');

    await server.close();
    environment.cleanup();
  });

  it('重投再次平票时无人淘汰并进入下一轮', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const policy = new TiePolicy({ revoteMap: { 'player-5': 'player-4' } });
    const server = buildServer({ ...environment.dependencies, agentPolicyFactory: () => policy });
    const created = await createGame(server);
    const tied = await submitHumanDescriptionAndVote(
      server,
      created.gameId,
      created.human.playerId,
      'player-3',
      'revote-tie',
    );
    const revoting = (tied.json() as { data: HumanView }).data;

    const revoted = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/votes`,
      payload: {
        commandId: 'human-revote-tie',
        actorId: created.human.playerId,
        expectedRevision: revoting.revision,
        targetPlayerId: 'player-3',
      },
    });
    expect(revoted.statusCode, revoted.body).toBe(200);
    const after = (revoted.json() as { data: HumanView }).data;
    expect(after.players.every((player) => player.alive)).toBe(true);
    expect(after.round?.number).toBe(2);
    expect(after.phase).toBe('speaking');

    const { data } = await readEvents(server, created.gameId);
    expect(data.frames).toContainEqual(
      expect.objectContaining({
        type: 'round_ended_without_elimination',
        payload: { reason: 'revote_tie' },
      }),
    );

    await server.close();
    environment.cleanup();
  });

  it('人类作为平票候选时可通过 defenses 辩解，且泄词不回显原文', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const policy = new TiePolicy({
      voteMap: {
        'player-3': 'player-2',
        'player-4': 'player-3',
        'player-5': 'player-2',
      },
    });
    const server = buildServer({ ...environment.dependencies, agentPolicyFactory: () => policy });
    const created = await createGame(server);
    const tied = await submitHumanDescriptionAndVote(
      server,
      created.gameId,
      created.human.playerId,
      'player-3',
      'human-defense',
    );
    const defending = (tied.json() as { data: HumanView }).data;
    expect(defending.phase).toBe('tie_defense');
    expect(defending.round?.currentActorId).toBe(created.human.playerId);
    expect(defending.allowedCommands).toContain('SubmitDefense');

    const rejected = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/defenses`,
      payload: {
        commandId: 'human-defense-leak',
        actorId: created.human.playerId,
        expectedRevision: defending.revision,
        text: defending.human.ownWordCard,
      },
    });
    expect(rejected.statusCode).toBe(422);
    expect(rejected.json()).toMatchObject({ error: { code: 'CONTENT_REJECTED' } });
    expect(rejected.body).not.toContain(defending.human.ownWordCard);

    const defended = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/defenses`,
      payload: {
        commandId: 'human-defense-valid',
        actorId: created.human.playerId,
        expectedRevision: defending.revision,
        text: '我的前后描述并不矛盾',
      },
    });
    expect(defended.statusCode, defended.body).toBe(200);
    const after = (defended.json() as { data: HumanView }).data;
    expect(after.phase).toBe('speaking');
    expect(after.round?.number).toBe(2);
    expect(after.players.find((player) => player.playerId === 'player-3')?.alive).toBe(false);

    const { data } = await readEvents(server, created.gameId);
    expect(data.frames).toContainEqual(
      expect.objectContaining({
        type: 'speech_published',
        payload: {
          actorId: created.human.playerId,
          actionType: 'defend',
          text: '我的前后描述并不矛盾',
        },
      }),
    );
    expect(data.frames).toContainEqual(
      expect.objectContaining({
        type: 'revote_started',
        payload: {
          participantIds: ['player-4', 'player-5'],
          candidateIds: ['player-3', 'player-2'],
        },
      }),
    );

    await server.close();
    environment.cleanup();
  });

  it('全员最高票不进入辩解和重投，直接进入下一轮', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const policy = new TiePolicy({
      voteMap: {
        'player-3': 'player-4',
        'player-4': 'player-5',
        'player-5': 'player-2',
      },
    });
    const server = buildServer({ ...environment.dependencies, agentPolicyFactory: () => policy });
    const created = await createGame(server);
    const result = await submitHumanDescriptionAndVote(
      server,
      created.gameId,
      created.human.playerId,
      'player-3',
      'all-tied',
    );
    expect(result.statusCode, result.body).toBe(200);
    const after = (result.json() as { data: HumanView }).data;
    expect(after.round?.number).toBe(2);
    expect(after.phase).toBe('speaking');
    expect(policy.actionTypes).not.toContain('defend');
    expect(policy.actionTypes).not.toContain('revote');

    const { data } = await readEvents(server, created.gameId);
    expect(data.frames.some((frame) => frame.type === 'tie_declared')).toBe(false);
    expect(data.frames).toContainEqual(
      expect.objectContaining({
        type: 'round_ended_without_elimination',
        payload: { reason: 'all_max' },
      }),
    );

    await server.close();
    environment.cleanup();
  });

  it('重复提交同一命令编号幂等，不产生重复事件', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    const paused = (await getView(server, created.gameId)).data;

    const payload = {
      commandId: 'human-describe-dup',
      actorId: created.human.playerId,
      expectedRevision: paused.revision,
      text: GENERIC_DESCRIBE,
    };
    const first = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/descriptions`,
      payload,
    });
    const repeated = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/descriptions`,
      payload,
    });

    expect(repeated.statusCode).toBe(200);
    expect(repeated.json()).toEqual(first.json());

    const describeCount = environment.dependencies.database.sqlite
      .prepare(
        "SELECT COUNT(*) AS count FROM game_events WHERE game_id = ? AND type = 'speech_published' AND command_id = ?",
      )
      .get(created.gameId, payload.commandId) as { count: number };
    expect(describeCount.count).toBe(1);

    await server.close();
    environment.cleanup();
  });

  it('过期修订号提交描述被拒绝', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    const paused = (await getView(server, created.gameId)).data;

    const response = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/descriptions`,
      payload: {
        commandId: 'human-describe-stale',
        actorId: created.human.playerId,
        expectedRevision: paused.revision + 5,
        text: GENERIC_DESCRIBE,
      },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'REVISION_CONFLICT' } });

    await server.close();
    environment.cleanup();
  });

  it('人类提交泄露原词的描述返回 CONTENT_REJECTED 且不回显原文', async () => {
    const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
    const server = buildServer(environment.dependencies);
    const created = await createGame(server);
    const paused = (await getView(server, created.gameId)).data;

    const response = await server.inject({
      method: 'POST',
      url: `/api/games/${created.gameId}/descriptions`,
      payload: {
        commandId: 'human-describe-leak',
        actorId: created.human.playerId,
        expectedRevision: paused.revision,
        text: paused.human.ownWordCard,
      },
    });
    expect(response.statusCode).toBe(422);
    const body = response.json() as { error: { code: string; message: string } };
    expect(body.error.code).toBe('CONTENT_REJECTED');
    expect(JSON.stringify(body)).not.toContain(paused.human.ownWordCard);

    await server.close();
    environment.cleanup();
  });
});

async function assertPublicIsolation(
  server: FastifyInstance,
  dependencies: ServerDependencies,
  gameId: string,
) {
  const { data } = await readEvents(server, gameId);
  const serialized = JSON.stringify(data.frames);

  const players = readPlayers(dependencies, gameId);
  const words = new Set(players.map((player) => player.word_card));
  expect(words.size).toBeGreaterThan(1); // 私有表保存了两种词牌
  for (const word of words) {
    expect(serialized).not.toContain(word);
  }

  expect(serialized).not.toContain('camp');
  expect(serialized).not.toContain('undercover');
  expect(serialized).not.toContain('civilian');
  expect(serialized).not.toContain('reasoningSummary');
  expect(serialized).not.toContain('probability');
  expect(serialized).not.toContain('opposingWord');
  expect(serialized).not.toContain('confidence');

  // 私有信念确实被持久化到 agent_actions，但不进入公开帧。
  const beliefCount = dependencies.database.sqlite
    .prepare('SELECT COUNT(*) AS count FROM agent_actions WHERE game_id = ?')
    .get(gameId) as { count: number };
  expect(beliefCount.count).toBeGreaterThan(0);
}

class TiePolicy implements AgentPolicy {
  readonly actionTypes: AgentTurnInput['actionType'][] = [];
  readonly calls: Array<{
    playerId: string;
    actionType: AgentTurnInput['actionType'];
    context: AgentActContext | undefined;
  }> = [];
  private readonly voteMap: Record<string, string>;
  private readonly revoteMap: Record<string, string>;

  constructor(options: { voteMap?: Record<string, string>; revoteMap?: Record<string, string> } = {}) {
    this.voteMap = options.voteMap ?? {
      'player-3': 'player-4',
      'player-4': 'player-3',
      'player-5': 'player-4',
    };
    this.revoteMap = options.revoteMap ?? {};
  }

  async act(
    input: AgentTurnInput,
    context?: AgentActContext,
  ): Promise<SpeechActionOutput | VoteActionOutput> {
    this.actionTypes.push(input.actionType);
    this.calls.push({
      playerId: input.actor.playerId,
      actionType: input.actionType,
      context,
    });
    const belief = this.belief(input);
    if (input.actionType === 'describe') {
      return { belief, text: GENERIC_DESCRIBE };
    }
    if (input.actionType === 'defend') {
      return { belief, text: '我的描述前后一致' };
    }
    if (input.actionType === 'revote') {
      const target = this.revoteMap[input.actor.playerId] ?? input.legalTargets[0]!;
      return { belief, targetPlayerId: target, reason: '根据公开辩解进行重投' };
    }
    const target = this.voteMap[input.actor.playerId] ?? input.legalTargets[0]!;
    return { belief, targetPlayerId: target, reason: '构造平票的确定性投票' };
  }

  priorBeliefs(): readonly BeliefSnapshot[] {
    return [];
  }

  private belief(input: AgentTurnInput): BeliefSnapshot {
    const living = input.players.filter((player) => player.alive);
    const probability = input.publicConfig.undercoverCount / living.length;
    return validateBeliefSnapshot(
      {
        opposingWordCandidates: [{ word: '未知词', confidence: 0.2, evidence: '信息有限' }],
        playerUndercoverProbabilities: living.map((player) => ({
          playerId: player.playerId,
          probability,
        })),
        reasoningSummary: '构造平票的确定性信念',
      },
      living.map((player) => player.playerId),
      input.publicConfig.undercoverCount,
    );
  }
}
