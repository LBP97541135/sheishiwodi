import { describe, expect, it } from 'vitest';

import {
  abandonGame,
  continueSpectating,
  createPreparingGame,
  projectHumanGameView,
  startPreparingGame,
  submitDefense,
  submitDescription,
  submitVote,
  terminateForSystemError,
  type Clock,
  type GameSnapshot,
  type IdSource,
  type RandomSource,
  type WordPair,
} from '../src/index.js';

class SequenceIds implements IdSource {
  private cursor = 0;
  nextId(kind: 'game' | 'player' | 'event') {
    this.cursor += 1;
    return `${kind}-${this.cursor}`;
  }
}

const clock: Clock = { now: () => '2026-08-16T12:00:00.000Z' };
const random: RandomSource = { next: () => 0 };
const pair: WordPair = {
  id: 'easy-1',
  civilianWord: '牛奶',
  undercoverWord: '豆浆',
  category: '饮品',
  difficulty: 'easy',
  enabled: true,
};

function startedGame() {
  const ids = new SequenceIds();
  const created = createPreparingGame(
    {
      type: 'CreateGame',
      commandId: 'create',
      human: { displayName: '玩家', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
    [pair],
    { random, ids, clock },
  );
  return {
    ids,
    transition: startPreparingGame(
      created.snapshot,
      {
        type: 'StartGame',
        commandId: 'start',
        gameId: created.snapshot.gameId,
        actorId: created.snapshot.humanPlayerId,
        expectedRevision: 0,
      },
      { ids, clock },
    ),
  };
}

function describeAll(snapshot: GameSnapshot, ids: SequenceIds) {
  let current = snapshot;
  for (let index = 0; index < snapshot.players.length; index += 1) {
    const actorId = current.round!.currentActorId;
    current = submitDescription(
      current,
      {
        type: 'SubmitDescription',
        commandId: `speech-${index}`,
        gameId: current.gameId,
        actorId,
        expectedRevision: current.revision,
        text: `线索${index + 1}`,
      },
      { ids, clock },
    ).snapshot;
  }
  return current;
}

describe('主动放弃状态机', () => {
  it('准备阶段确认放弃进入无胜者终局并保留既有事实', () => {
    const ids = new SequenceIds();
    const created = createPreparingGame(
      {
        type: 'CreateGame',
        commandId: 'create-abandon',
        human: { displayName: '玩家', silhouette: 'silhouette_a' },
        difficulty: 'easy',
      },
      [pair],
      { random, ids, clock },
    );
    const result = abandonGame(
      created.snapshot,
      {
        type: 'AbandonGame',
        commandId: 'abandon-preparing',
        gameId: created.snapshot.gameId,
        actorId: created.snapshot.humanPlayerId,
        expectedRevision: created.snapshot.revision,
        confirmed: true,
      },
      { ids, clock },
    );
    expect(result.snapshot.status).toBe('abandoned');
    expect(result.snapshot.phase).toBe('ended');
    expect(result.snapshot.endReason).toBe('abandoned_by_human');
    expect(result.snapshot).not.toHaveProperty('winnerCamp');
    expect(projectHumanGameView(result.snapshot)).not.toHaveProperty('reveal');
    expect(result.events).toContainEqual(
      expect.objectContaining({ type: 'game_abandoned', visibility: 'public' }),
    );
  });

  it('进行中放弃并拒绝非人类、过期修订和重复终局转换', () => {
    const { ids, transition } = startedGame();
    const snapshot = transition.snapshot;
    const agentId = snapshot.players.find((player) => player.kind === 'agent')!.playerId;
    const base = {
      type: 'AbandonGame' as const,
      commandId: 'abandon-active',
      gameId: snapshot.gameId,
      actorId: snapshot.humanPlayerId,
      expectedRevision: snapshot.revision,
      confirmed: true as const,
    };
    expect(() => abandonGame(snapshot, { ...base, actorId: agentId }, { ids, clock })).toThrow(
      'ACTOR_NOT_ALLOWED',
    );
    expect(() =>
      abandonGame(snapshot, { ...base, expectedRevision: snapshot.revision + 1 }, { ids, clock }),
    ).toThrow('REVISION_CONFLICT');
    const abandoned = abandonGame(snapshot, base, { ids, clock });
    expect(abandoned.snapshot.status).toBe('abandoned');
    expect(abandoned.snapshot.round).toBeNull();
    expect(() =>
      abandonGame(
        abandoned.snapshot,
        { ...base, commandId: 'abandon-again', expectedRevision: abandoned.snapshot.revision },
        { ids, clock },
      ),
    ).toThrow('INVALID_TRANSITION');
  });
});

describe('模型系统错误终止状态机', () => {
  it('进行中终止进入 system_terminated 且不含胜方与揭晓', () => {
    const { ids, transition } = startedGame();
    const snapshot = transition.snapshot;
    const result = terminateForSystemError(
      snapshot,
      {
        type: 'TerminateForSystemError',
        commandId: 'terminate-1',
        gameId: snapshot.gameId,
        actorId: snapshot.humanPlayerId,
        expectedRevision: snapshot.revision,
        failedActionId: 'auto/x/describe',
        errorType: 'CALL_FAILED',
      },
      { ids, clock },
    );
    expect(result.snapshot.status).toBe('system_terminated');
    expect(result.snapshot.phase).toBe('ended');
    expect(result.snapshot.round).toBeNull();
    expect(result.snapshot.endReason).toBe('model_failure_limit');
    expect(result.snapshot).not.toHaveProperty('winnerCamp');
    expect(projectHumanGameView(result.snapshot)).not.toHaveProperty('reveal');
    expect(result.events).toContainEqual(
      expect.objectContaining({
        type: 'game_system_terminated',
        visibility: 'public',
        payload: { failedActionId: 'auto/x/describe', errorType: 'CALL_FAILED' },
      }),
    );
  });

  it('拒绝过期修订与非进行中状态', () => {
    const { ids, transition } = startedGame();
    const snapshot = transition.snapshot;
    const base = {
      type: 'TerminateForSystemError' as const,
      commandId: 'terminate-guard',
      gameId: snapshot.gameId,
      actorId: snapshot.humanPlayerId,
      expectedRevision: snapshot.revision,
      failedActionId: 'auto/x/vote',
      errorType: 'FORMAT_INVALID',
    };
    expect(() =>
      terminateForSystemError(snapshot, { ...base, expectedRevision: snapshot.revision + 1 }, { ids, clock }),
    ).toThrow('REVISION_CONFLICT');
    const terminated = terminateForSystemError(snapshot, base, { ids, clock });
    expect(() =>
      terminateForSystemError(
        terminated.snapshot,
        { ...base, commandId: 'terminate-again', expectedRevision: terminated.snapshot.revision },
        { ids, clock },
      ),
    ).toThrow('INVALID_TRANSITION');
  });
});

describe('描述状态机', () => {
  it('按顺序推进并在最后一人后进入秘密投票', () => {
    const { ids, transition } = startedGame();
    let current = transition.snapshot;
    const order = current.round!.speakingOrder;

    for (let index = 0; index < order.length; index += 1) {
      const result = submitDescription(
        current,
        {
          type: 'SubmitDescription',
          commandId: `speech-${index}`,
          gameId: current.gameId,
          actorId: order[index]!,
          expectedRevision: current.revision,
          text: `线索${index + 1}`,
        },
        { ids, clock },
      );
      expect(result.events[0]?.type).toBe('speech_published');
      current = result.snapshot;
    }

    expect(current.phase).toBe('voting');
    expect(current.round?.actionType).toBe('vote');
    expect(current.round?.currentActorId).toBe(current.players[0]?.playerId);
  });

  it('拒绝泄词且不产生事件', () => {
    const { ids, transition } = startedGame();
    const actorId = transition.snapshot.round!.currentActorId;
    const actor = transition.snapshot.players.find((player) => player.playerId === actorId)!;
    expect(() =>
      submitDescription(
        transition.snapshot,
        {
          type: 'SubmitDescription',
          commandId: 'leak',
          gameId: transition.snapshot.gameId,
          actorId,
          expectedRevision: transition.snapshot.revision,
          text: `这是${actor.wordCard}`,
        },
        { ids, clock },
      ),
    ).toThrow('CONTENT_REJECTED:WORD_LEAK');
  });
});

describe('秘密投票状态机', () => {
  it('单票只公开完成进度，最后一票才统一揭晓并淘汰', () => {
    const { ids, transition } = startedGame();
    let current = describeAll(transition.snapshot, ids);
    const voters = current.players.map((player) => player.playerId);
    const target = current.players[0]!.playerId;

    for (const [index, voterId] of voters.entries()) {
      const targetPlayerId = voterId === target ? current.players[1]!.playerId : target;
      const result = submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: `vote-${index}`,
          gameId: current.gameId,
          actorId: voterId,
          expectedRevision: current.revision,
          targetPlayerId,
        },
        { ids, clock },
      );
      if (index < voters.length - 1) {
        expect(result.events.some((event) => event.type === 'votes_revealed')).toBe(false);
        expect(result.events.find((event) => event.type === 'vote_progressed')?.payload).toEqual({
          playerId: voterId,
        });
      } else {
        expect(result.events.filter((event) => event.type === 'votes_revealed')).toHaveLength(1);
        expect(result.events.some((event) => event.type === 'player_eliminated')).toBe(true);
        expect(result.events).toContainEqual(
          expect.objectContaining({ type: 'terminal_reveal_ready', visibility: 'public', payload: {} }),
        );
      }
      current = result.snapshot;
    }

    expect(current.status).toBe('finished');
    const view = projectHumanGameView(current);
    expect(view.winnerCamp).toBe('civilian');
    expect(view.reveal?.wordPair).toEqual({
      civilianWord: pair.civilianWord,
      undercoverWord: pair.undercoverWord,
      category: pair.category,
    });
    expect(view.reveal?.players).toEqual(
      [...current.players]
        .sort((left, right) => left.seatIndex - right.seatIndex)
        .map(({ playerId, seatIndex, camp, wordCard }) => ({
          playerId,
          seatIndex,
          camp,
          wordCard,
        })),
    );
  });

  it('人类平民被淘汰后暂停等待观战选择，继续后进入下一轮', () => {
    const { ids, transition } = startedGame();
    const humanId = transition.snapshot.humanPlayerId;
    const players = transition.snapshot.players.map((player) =>
      player.playerId === humanId
        ? { ...player, camp: 'civilian' as const, wordCard: pair.civilianWord }
        : player.seatIndex === 1
          ? { ...player, camp: 'undercover' as const, wordCard: pair.undercoverWord }
          : { ...player, camp: 'civilian' as const, wordCard: pair.civilianWord },
    );
    let current = describeAll({ ...transition.snapshot, players }, ids);
    const voters = current.players.map((player) => player.playerId);
    const fallbackTarget = current.players.find((player) => player.playerId !== humanId)!.playerId;
    for (const [index, voterId] of voters.entries()) {
      current = submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: `spectator-vote-${index}`,
          gameId: current.gameId,
          actorId: voterId,
          expectedRevision: current.revision,
          targetPlayerId: voterId === humanId ? fallbackTarget : humanId,
        },
        { ids, clock },
      ).snapshot;
    }

    expect(current.status).toBe('awaiting_spectator');
    expect(current.phase).toBe('ended');
    expect(current.round).toBeNull();
    expect(current.resumeAfterSpectating?.number).toBe(2);
    expect(current.players.find((player) => player.playerId === humanId)?.alive).toBe(false);
    expect(projectHumanGameView(current)).not.toHaveProperty('reveal');

    const continued = continueSpectating(
      current,
      {
        type: 'ContinueSpectating',
        commandId: 'continue-spectating',
        gameId: current.gameId,
        actorId: humanId,
        expectedRevision: current.revision,
      },
      { ids, clock },
    );
    expect(continued.snapshot.status).toBe('in_progress');
    expect(continued.snapshot.phase).toBe('speaking');
    expect(continued.snapshot.round?.number).toBe(2);
    expect(continued.snapshot).not.toHaveProperty('resumeAfterSpectating');
    expect(continued.events.map((event) => event.type)).toEqual([
      'spectating_started',
      'round_started',
      'turn_started',
    ]);
  });

  it('淘汰一名平民后进入第二轮并把阶段重置为描述', () => {
    const { ids, transition } = startedGame();
    let current = describeAll(transition.snapshot, ids);
    // random.next=0 使 0 号座位（人类）为卧底，淘汰任一平民不会终局。
    const undercoverId = current.players.find((player) => player.camp === 'undercover')!.playerId;
    const eliminatedId = current.players.find((player) => player.camp === 'civilian')!.playerId;

    for (const [index, voterId] of current.players.map((player) => player.playerId).entries()) {
      const targetPlayerId = voterId === eliminatedId ? undercoverId : eliminatedId;
      current = submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: `round1-vote-${index}`,
          gameId: current.gameId,
          actorId: voterId,
          expectedRevision: current.revision,
          targetPlayerId,
        },
        { ids, clock },
      ).snapshot;
    }

    expect(current.status).toBe('in_progress');
    expect(current.round?.number).toBe(2);
    expect(current.phase).toBe('speaking');
    expect(current.round?.actionType).toBe('describe');
    expect(current.players.filter((player) => player.alive)).toHaveLength(3);

    // 第二轮首名存活玩家应能正常提交描述，不再因阶段未重置而被拒。
    const nextActorId = current.round!.currentActorId;
    const next = submitDescription(
      current,
      {
        type: 'SubmitDescription',
        commandId: 'round2-speech',
        gameId: current.gameId,
        actorId: nextActorId,
        expectedRevision: current.revision,
        text: '第二轮的普通线索',
      },
      { ids, clock },
    );
    expect(next.events[0]?.type).toBe('speech_published');
  });

  it('拒绝自投', () => {
    const { ids, transition } = startedGame();
    const current = describeAll(transition.snapshot, ids);
    const actorId = current.round!.currentActorId;
    expect(() =>
      submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: 'self-vote',
          gameId: current.gameId,
          actorId,
          expectedRevision: current.revision,
          targetPlayerId: actorId,
        },
        { ids, clock },
      ),
    ).toThrow('ACTOR_NOT_ALLOWED');
  });

  it('部分平票进入 tie_defense 并停在首名候选', () => {
    const { ids, transition } = startedGame();
    let current = describeAll(transition.snapshot, ids);
    const players = current.players.map((player) => player.playerId);
    const targets = [players[1]!, players[0]!, players[1]!, players[0]!];

    for (const [index, voterId] of players.entries()) {
      current = submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: `tie-${index}`,
          gameId: current.gameId,
          actorId: voterId,
          expectedRevision: current.revision,
          targetPlayerId: targets[index]!,
        },
        { ids, clock },
      ).snapshot;
    }

    expect(current.phase).toBe('tie_defense');
    expect(current.round?.actionType).toBe('defend');
    expect(current.round?.tieCandidateIds).toEqual([players[1], players[0]]);
    expect(current.round?.currentActorId).toBe(players[1]);
  });

  it('全员最高票直接无人淘汰并进入下一轮', () => {
    const { ids, transition } = startedGame();
    let current = describeAll(transition.snapshot, ids);
    const players = current.players.map((player) => player.playerId);
    const targets = [players[1]!, players[0]!, players[3]!, players[2]!];
    let finalEvents: ReturnType<typeof submitVote>['events'] = [];

    for (const [index, voterId] of players.entries()) {
      const result = submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: `all-tied-${index}`,
          gameId: current.gameId,
          actorId: voterId,
          expectedRevision: current.revision,
          targetPlayerId: targets[index]!,
        },
        { ids, clock },
      );
      current = result.snapshot;
      finalEvents = result.events;
    }

    expect(finalEvents).toContainEqual(
      expect.objectContaining({
        type: 'round_ended_without_elimination',
        payload: { reason: 'all_max' },
      }),
    );
    expect(finalEvents.some((event) => event.type === 'tie_declared')).toBe(false);
    expect(current.phase).toBe('speaking');
    expect(current.round?.number).toBe(2);
    expect(current.players.every((player) => player.alive)).toBe(true);
  });
});

describe('平票辩解与重投状态机', () => {
  function partialTie() {
    const { ids, transition } = startedGame();
    let current = describeAll(transition.snapshot, ids);
    const players = current.players.map((player) => player.playerId);
    const targets = [players[1]!, players[0]!, players[1]!, players[0]!];
    for (const [index, voterId] of players.entries()) {
      current = submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: `partial-tie-${index}`,
          gameId: current.gameId,
          actorId: voterId,
          expectedRevision: current.revision,
          targetPlayerId: targets[index]!,
        },
        { ids, clock },
      ).snapshot;
    }
    return { ids, current, players, candidates: current.round!.tieCandidateIds };
  }

  function defendAll(currentSnapshot: GameSnapshot, ids: SequenceIds) {
    let current = currentSnapshot;
    const candidates = [...current.round!.tieCandidateIds];
    for (const [index, actorId] of candidates.entries()) {
      current = submitDefense(
        current,
        {
          type: 'SubmitDefense',
          commandId: `defense-${index}`,
          gameId: current.gameId,
          actorId,
          expectedRevision: current.revision,
          text: `辩解线索${index + 1}`,
        },
        { ids, clock },
      ).snapshot;
    }
    return current;
  }

  it('候选依次辩解，全部完成后只允许非候选重投', () => {
    const { ids, current: tied, players, candidates } = partialTie();
    const first = submitDefense(
      tied,
      {
        type: 'SubmitDefense',
        commandId: 'first-defense',
        gameId: tied.gameId,
        actorId: candidates[0]!,
        expectedRevision: tied.revision,
        text: '这是第一段辩解',
      },
      { ids, clock },
    );
    expect(first.events[0]).toEqual(
      expect.objectContaining({
        type: 'speech_published',
        payload: expect.objectContaining({ actionType: 'defend' }),
      }),
    );
    expect(first.snapshot.round?.currentActorId).toBe(candidates[1]);

    const second = submitDefense(
      first.snapshot,
      {
        type: 'SubmitDefense',
        commandId: 'second-defense',
        gameId: tied.gameId,
        actorId: candidates[1]!,
        expectedRevision: first.snapshot.revision,
        text: '这是第二段辩解',
      },
      { ids, clock },
    );
    const nonCandidates = players.filter((playerId) => !candidates.includes(playerId));
    expect(second.snapshot.phase).toBe('revoting');
    expect(second.snapshot.round?.actionType).toBe('revote');
    expect(second.snapshot.round?.currentActorId).toBe(nonCandidates[0]);
    expect(second.events).toContainEqual(
      expect.objectContaining({
        type: 'revote_started',
        payload: { participantIds: nonCandidates, candidateIds: candidates },
      }),
    );
  });

  it('拒绝非候选辩解、泄词、候选重投和非候选目标', () => {
    const { ids, current: tied, players, candidates } = partialTie();
    const nonCandidate = players.find((playerId) => !candidates.includes(playerId))!;
    expect(() =>
      submitDefense(
        tied,
        {
          type: 'SubmitDefense',
          commandId: 'invalid-defender',
          gameId: tied.gameId,
          actorId: nonCandidate,
          expectedRevision: tied.revision,
          text: '不该允许的辩解',
        },
        { ids, clock },
      ),
    ).toThrow('ACTOR_NOT_ALLOWED');

    const defender = tied.players.find((player) => player.playerId === candidates[0])!;
    expect(() =>
      submitDefense(
        tied,
        {
          type: 'SubmitDefense',
          commandId: 'leaked-defense',
          gameId: tied.gameId,
          actorId: defender.playerId,
          expectedRevision: tied.revision,
          text: `我拿到的是${defender.wordCard}`,
        },
        { ids, clock },
      ),
    ).toThrow('CONTENT_REJECTED:WORD_LEAK');

    const revoting = defendAll(tied, ids);
    expect(() =>
      submitVote(
        revoting,
        {
          type: 'SubmitVote',
          commandId: 'candidate-revote',
          gameId: revoting.gameId,
          actorId: candidates[0]!,
          expectedRevision: revoting.revision,
          targetPlayerId: candidates[1]!,
        },
        { ids, clock },
      ),
    ).toThrow('ACTOR_NOT_ALLOWED');
    expect(() =>
      submitVote(
        revoting,
        {
          type: 'SubmitVote',
          commandId: 'invalid-revote-target',
          gameId: revoting.gameId,
          actorId: revoting.round!.currentActorId,
          expectedRevision: revoting.revision,
          targetPlayerId: nonCandidate,
        },
        { ids, clock },
      ),
    ).toThrow('ACTOR_NOT_ALLOWED');
  });

  it('重投唯一最高票时统一揭票并淘汰候选', () => {
    const { ids, current: tied, players, candidates } = partialTie();
    let current = defendAll(tied, ids);
    const voters = players.filter((playerId) => !candidates.includes(playerId));
    let finalEvents: ReturnType<typeof submitVote>['events'] = [];

    for (const [index, voterId] of voters.entries()) {
      const result = submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: `revote-win-${index}`,
          gameId: current.gameId,
          actorId: voterId,
          expectedRevision: current.revision,
          targetPlayerId: candidates[0]!,
        },
        { ids, clock },
      );
      if (index === 0) {
        expect(result.events.some((event) => event.type === 'votes_revealed')).toBe(false);
        expect(result.events.find((event) => event.type === 'vote_progressed')?.payload).toEqual({
          playerId: voterId,
        });
      }
      current = result.snapshot;
      finalEvents = result.events;
    }

    expect(finalEvents.filter((event) => event.type === 'votes_revealed')).toHaveLength(1);
    expect(finalEvents).toContainEqual(
      expect.objectContaining({ type: 'player_eliminated', payload: { playerId: candidates[0] } }),
    );
    expect(current.players.find((player) => player.playerId === candidates[0])?.alive).toBe(false);
  });

  it('重投再次平票时无人淘汰并轮换进入下一轮', () => {
    const { ids, current: tied, players, candidates } = partialTie();
    let current = defendAll(tied, ids);
    const voters = players.filter((playerId) => !candidates.includes(playerId));
    let finalEvents: ReturnType<typeof submitVote>['events'] = [];

    for (const [index, voterId] of voters.entries()) {
      const result = submitVote(
        current,
        {
          type: 'SubmitVote',
          commandId: `revote-tie-${index}`,
          gameId: current.gameId,
          actorId: voterId,
          expectedRevision: current.revision,
          targetPlayerId: candidates[index]!,
        },
        { ids, clock },
      );
      current = result.snapshot;
      finalEvents = result.events;
    }

    expect(finalEvents).toContainEqual(
      expect.objectContaining({
        type: 'round_ended_without_elimination',
        payload: { reason: 'revote_tie' },
      }),
    );
    expect(current.phase).toBe('speaking');
    expect(current.round?.number).toBe(2);
    expect(current.round?.tieCandidateIds).toEqual([]);
    expect(current.players.every((player) => player.alive)).toBe(true);
  });

  it('公开投影只向当前人类开放辩解或候选重投目标', () => {
    const { ids, current: tied, candidates } = partialTie();
    const humanId = tied.humanPlayerId;
    const humanIsCandidate = candidates.includes(humanId);
    const defenseView = projectHumanGameView(tied);

    if (humanIsCandidate && tied.round?.currentActorId === humanId) {
      expect(defenseView.allowedCommands).toContain('SubmitDefense');
    } else {
      expect(defenseView.allowedCommands).not.toContain('SubmitDefense');
    }
    expect(defenseView.legalVoteTargetIds).toEqual([]);

    const revoting = defendAll(tied, ids);
    const revoteView = projectHumanGameView(revoting);
    if (!humanIsCandidate && revoting.round?.currentActorId === humanId) {
      expect(revoteView.allowedCommands).toContain('SubmitVote');
      expect(revoteView.legalVoteTargetIds).toEqual(candidates);
    } else {
      expect(revoteView.allowedCommands).not.toContain('SubmitVote');
      expect(revoteView.legalVoteTargetIds).toEqual([]);
    }
    const serialized = JSON.stringify(revoteView);
    expect(serialized).not.toContain('targetPlayerId');
    expect(serialized).not.toContain('votes');
  });
});
