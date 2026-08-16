import { describe, expect, it } from 'vitest';

import {
  projectHumanGameView,
  submitDescription,
  validateBeliefSnapshot,
  type BeliefSnapshot,
} from '@sheishiwodi/shared';

import { buildServer } from '../server.js';
import { createTestEnvironment } from '../test-environment.js';
import { GameRepository } from './game-repository.js';

const failureCases = [
  { table: 'game_events', operation: 'INSERT' },
  { table: 'agent_actions', operation: 'INSERT' },
  { table: 'public_stream_entries', operation: 'INSERT' },
  { table: 'games', operation: 'UPDATE' },
  { table: 'processed_commands', operation: 'INSERT' },
] as const;

describe('GameRepository 原子提交', () => {
  for (const failure of failureCases) {
    it(`${failure.table} 写入失败时整体回滚且可以安全重试`, async () => {
      const environment = createTestEnvironment([0, 0.76, 0, 0, 0]);
      const server = buildServer(environment.dependencies);
      await server.ready();
      const created = await server.inject({
        method: 'POST',
        url: '/api/games',
        payload: {
          commandId: `create-${failure.table}`,
          human: { displayName: '事务测试', silhouette: 'silhouette_a' },
          difficulty: 'easy',
        },
      });
      const preparing = (created.json() as {
        data: { gameId: string; revision: number; human: { playerId: string } };
      }).data;
      await server.inject({
        method: 'POST',
        url: `/api/games/${preparing.gameId}/start`,
        payload: {
          commandId: `start-${failure.table}`,
          actorId: preparing.human.playerId,
          expectedRevision: preparing.revision,
        },
      });

      const repository = new GameRepository(environment.dependencies.database);
      const previous = repository.findSnapshot(preparing.gameId)!;
      expect(previous.round?.currentActorId).toBe(previous.humanPlayerId);
      expect(previous.round?.actionType).toBe('describe');

      const commandId = `fault-${failure.table}`;
      const transition = submitDescription(
        previous,
        {
          type: 'SubmitDescription',
          commandId,
          gameId: previous.gameId,
          actorId: previous.humanPlayerId,
          expectedRevision: previous.revision,
          text: '事务失败后仍可重试',
        },
        { ids: environment.dependencies.ids, clock: environment.dependencies.clock },
      );
      const timeline = [
        ...repository.listPublicTimeline(previous.gameId),
        ...repository.publicTimelineWith(transition.events),
      ];
      const response = projectHumanGameView(transition.snapshot, timeline);
      const agent = previous.players.find((player) => player.kind === 'agent')!;
      const belief = makeBelief(previous.players.filter((player) => player.alive).map((player) => player.playerId));
      const input = {
        previous,
        snapshot: transition.snapshot,
        events: transition.events,
        commandId,
        requestHash: `hash-${failure.table}`,
        response,
        privateAction: {
          actionId: `action-${failure.table}`,
          playerId: agent.playerId,
          roundNumber: previous.round!.number,
          actionType: 'describe',
          baseRevision: previous.revision,
          belief,
          output: { text: '事务失败后仍可重试' },
          completedAt: transition.snapshot.updatedAt,
        },
      };
      const before = readPersistentState(environment.dependencies.database, previous.gameId);
      const triggerName = `fail_${failure.table}`;
      environment.dependencies.database.sqlite.exec(
        `CREATE TRIGGER ${triggerName} BEFORE ${failure.operation} ON ${failure.table}
         BEGIN SELECT RAISE(ABORT, 'FAULT_${failure.table}'); END`,
      );

      expect(() => repository.commitTransition(input)).toThrow(`FAULT_${failure.table}`);
      expect(readPersistentState(environment.dependencies.database, previous.gameId)).toEqual(before);
      expect(repository.findProcessedCommand(commandId)).toBeNull();

      environment.dependencies.database.sqlite.exec(`DROP TRIGGER ${triggerName}`);
      repository.commitTransition(input);
      const after = readPersistentState(environment.dependencies.database, previous.gameId);
      expect(after.revision).toBe(previous.revision + 1);
      expect(after.events).toBe(before.events + transition.events.length);
      expect(after.actions).toBe(before.actions + 1);
      expect(after.frames).toBe(
        before.frames + transition.events.filter((event) => event.visibility === 'public').length,
      );
      expect(after.commands).toBe(before.commands + 1);

      await server.close();
      environment.cleanup();
    });
  }
});

function makeBelief(livingPlayerIds: string[]): BeliefSnapshot {
  const probability = 1 / livingPlayerIds.length;
  return validateBeliefSnapshot(
    {
      opposingWordCandidates: [{ word: '未知词', confidence: 0.2, evidence: '事务测试' }],
      playerUndercoverProbabilities: livingPlayerIds.map((playerId) => ({ playerId, probability })),
      reasoningSummary: '事务测试使用确定性均匀信念',
    },
    livingPlayerIds,
    1,
  );
}

function readPersistentState(
  database: ReturnType<typeof createTestEnvironment>['dependencies']['database'],
  gameId: string,
) {
  const game = database.sqlite
    .prepare('SELECT revision, event_seq, stream_seq, snapshot_json FROM games WHERE game_id = ?')
    .get(gameId) as {
    revision: number;
    event_seq: number;
    stream_seq: number;
    snapshot_json: string;
  };
  const count = (table: string) =>
    (
      database.sqlite
        .prepare(`SELECT COUNT(*) AS value FROM ${table} WHERE game_id = ?`)
        .get(gameId) as { value: number }
    ).value;
  return {
    revision: game.revision,
    eventSeq: game.event_seq,
    streamSeq: game.stream_seq,
    snapshotJson: game.snapshot_json,
    events: count('game_events'),
    actions: count('agent_actions'),
    frames: count('public_stream_entries'),
    commands: count('processed_commands'),
  };
}
