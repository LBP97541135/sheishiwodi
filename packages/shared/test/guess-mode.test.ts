import { describe, expect, it } from 'vitest';

import {
  createPreparingGame,
  continueSpectating,
  normalizeGuessWord,
  projectHumanGameView,
  startPreparingGame,
  submitDescription,
  submitGuess,
  submitVote,
  type Clock,
  type GameSnapshot,
  type IdSource,
  type RandomSource,
  type WordPair,
} from '../src/index.js';

class Ids implements IdSource {
  private value = 0;
  nextId(kind: 'game' | 'player' | 'event') { return `${kind}-${++this.value}`; }
}

const clock: Clock = { now: () => '2026-08-19T20:00:00.000Z' };
const random: RandomSource = { next: () => 0 };
const pair: WordPair = {
  id: 'pair-1', civilianWord: '牛奶', undercoverWord: '豆浆', category: '饮品', difficulty: 'easy', enabled: true,
};

function startedGuessGame() {
  const ids = new Ids();
  const created = createPreparingGame({
    type: 'CreateGame', commandId: 'create-guess', gameMode: 'guess',
    human: { displayName: '玩家', silhouette: 'silhouette_a' }, difficulty: 'easy',
  }, [pair], { ids, clock, random });
  const started = startPreparingGame(created.snapshot, {
    type: 'StartGame', commandId: 'start-guess', gameId: created.snapshot.gameId,
    actorId: created.snapshot.humanPlayerId, expectedRevision: 0,
  }, { ids, clock });
  return { ids, snapshot: started.snapshot };
}

function atVoting(snapshot: GameSnapshot, ids: Ids) {
  let current = snapshot;
  while (current.round?.actionType === 'describe') {
    current = submitDescription(current, {
      type: 'SubmitDescription', commandId: `speech-${current.revision}`, gameId: current.gameId,
      actorId: current.round.currentActorId, expectedRevision: current.revision, text: '普通线索',
    }, { ids, clock }).snapshot;
  }
  return current;
}

describe('猜词模式状态机', () => {
  it('只做 NFKC、首尾空白和拉丁字母小写规范化', () => {
    expect(normalizeGuessWord('  ＭiLK  ')).toBe('milk');
    expect(normalizeGuessWord('牛 奶')).not.toBe(normalizeGuessWord('牛奶'));
  });

  it('描述阶段猜中立即淘汰敌方，公开事件不包含目标或猜词', () => {
    const { ids, snapshot } = startedGuessGame();
    const actorId = snapshot.round!.currentActorId;
    const actor = snapshot.players.find((player) => player.playerId === actorId)!;
    const target = snapshot.players.find((player) => player.alive && player.camp !== actor.camp)!;
    const result = submitGuess(snapshot, {
      type: 'SubmitGuess', commandId: 'guess-now', gameId: snapshot.gameId, actorId,
      expectedRevision: snapshot.revision, targetPlayerId: target.playerId, guessedWord: target.wordCard,
    }, { ids, clock });

    expect(result.snapshot.players.find((player) => player.playerId === target.playerId)?.alive).toBe(false);
    expect(result.snapshot.players.find((player) => player.playerId === actorId)?.guessUsed).toBe(true);
    const guessEvent = result.events.find((event) => event.type === 'guess_resolved');
    expect(guessEvent?.payload).toEqual({ actorId, success: true });
    expect(JSON.stringify(guessEvent)).not.toContain(target.playerId);
    expect(JSON.stringify(guessEvent)).not.toContain(target.wordCard);
  });

  it('投票批次允许乱序暂存，并按冻结阵容同时结算至全员淘汰平局', () => {
    const { ids, snapshot } = startedGuessGame();
    let current = atVoting(snapshot, ids);
    const undercover = current.players.find((player) => player.camp === 'undercover')!;
    const civilians = current.players.filter((player) => player.camp === 'civilian');
    const choices = [
      { actor: undercover, target: civilians[0]!, word: civilians[0]!.wordCard },
      { actor: civilians[0]!, target: undercover, word: undercover.wordCard },
      { actor: civilians[1]!, target: undercover, word: '错误词' },
      { actor: civilians[2]!, target: undercover, word: '另一个错误词' },
    ];
    for (const [index, choice] of [...choices].reverse().entries()) {
      current = submitGuess(current, {
        type: 'SubmitGuess', commandId: `batch-guess-${index}`, gameId: current.gameId,
        actorId: choice.actor.playerId, expectedRevision: current.revision,
        targetPlayerId: choice.target.playerId, guessedWord: choice.word,
      }, { ids, clock }).snapshot;
    }

    expect(current.status).toBe('finished');
    expect(current.winnerCamp).toBe('draw');
    expect(current.endReason).toBe('all_players_eliminated');
    expect(current.players.every((player) => !player.alive)).toBe(true);
    expect(current.guessHistory).toHaveLength(4);
    const view = projectHumanGameView(current);
    expect(view.factReview?.guesses).toHaveLength(4);
  });

  it('猜测者没有选票，猜测淘汰后过滤死亡投票者和目标', () => {
    const { ids, snapshot } = startedGuessGame();
    let current = atVoting(snapshot, ids);
    const players = current.players;
    const guesser = players.find((player) => player.kind === 'agent' && player.camp === 'civilian')!;
    const target = players.find((player) => player.camp !== guesser.camp)!;
    current = submitGuess(current, {
      type: 'SubmitGuess', commandId: 'batch-fail', gameId: current.gameId,
      actorId: guesser.playerId, expectedRevision: current.revision,
      targetPlayerId: target.playerId, guessedWord: '必错',
    }, { ids, clock }).snapshot;
    for (const voter of players.filter((player) => player.playerId !== guesser.playerId)) {
      current = submitVote(current, {
        type: 'SubmitVote', commandId: `vote-${voter.playerId}`, gameId: current.gameId,
        actorId: voter.playerId, expectedRevision: current.revision, targetPlayerId: guesser.playerId,
      }, { ids, clock }).snapshot;
    }

    expect(current.round?.number).toBe(2);
    expect(current.players.find((player) => player.playerId === guesser.playerId)?.alive).toBe(false);
  });

  it('人类在最后一次发言猜错后，确认观战会恢复到投票而不是错误的新轮描述', () => {
    const { ids, snapshot } = startedGuessGame();
    const humanId = snapshot.humanPlayerId!;
    const otherIds = snapshot.players.filter((player) => player.playerId !== humanId).map((player) => player.playerId);
    const undercoverId = otherIds.at(-1)!;
    const humanLast = {
      ...snapshot,
      players: snapshot.players.map((player) => player.playerId === undercoverId
        ? { ...player, camp: 'undercover' as const, wordCard: pair.undercoverWord }
        : { ...player, camp: 'civilian' as const, wordCard: pair.civilianWord }),
      round: {
        ...snapshot.round!,
        speakingOrder: [...otherIds, humanId],
        currentActorId: humanId,
        completedSpeakerIds: otherIds,
      },
    };
    const target = humanLast.players.find((player) => player.playerId !== humanId)!;
    const guessed = submitGuess(humanLast, {
      type: 'SubmitGuess', commandId: 'human-last-fails', gameId: humanLast.gameId,
      actorId: humanId, expectedRevision: humanLast.revision,
      targetPlayerId: target.playerId, guessedWord: '必错词',
    }, { ids, clock });

    expect(guessed.snapshot.status).toBe('awaiting_spectator');
    expect(guessed.snapshot.resumeAfterSpectating?.actionType).toBe('vote');
    expect(guessed.events.some((event) => event.type === 'turn_started')).toBe(false);

    const continued = continueSpectating(guessed.snapshot, {
      type: 'ContinueSpectating', commandId: 'continue-after-guess', gameId: guessed.snapshot.gameId,
      actorId: humanId, expectedRevision: guessed.snapshot.revision,
    }, { ids, clock });
    expect(continued.snapshot.status).toBe('in_progress');
    expect(continued.snapshot.phase).toBe('voting');
    expect(continued.snapshot.round?.actionType).toBe('vote');
    expect(continued.events.map((event) => event.type)).toEqual(['spectating_started', 'turn_started']);
    expect(continued.events.at(-1)?.payload).toMatchObject({ actionType: 'vote' });
  });

  it('人类在投票批次猜错后暂停等待观战确认，再恢复到已结算出的下一阶段', () => {
    const { ids, snapshot } = startedGuessGame();
    const humanId = snapshot.humanPlayerId!;
    const agentIds = snapshot.players.filter((player) => player.playerId !== humanId).map((player) => player.playerId);
    const undercoverId = agentIds[0]!;
    let current = atVoting({
      ...snapshot,
      players: snapshot.players.map((player) => player.playerId === undercoverId
        ? { ...player, camp: 'undercover' as const, wordCard: pair.undercoverWord }
        : { ...player, camp: 'civilian' as const, wordCard: pair.civilianWord }),
    }, ids);
    const target = current.players.find((player) => player.playerId === undercoverId)!;
    current = submitGuess(current, {
      type: 'SubmitGuess', commandId: 'human-vote-guess-fails', gameId: current.gameId,
      actorId: humanId, expectedRevision: current.revision,
      targetPlayerId: target.playerId, guessedWord: '错误词',
    }, { ids, clock }).snapshot;

    let finalTransition: ReturnType<typeof submitVote> | undefined;
    for (const [index, actorId] of agentIds.entries()) {
      finalTransition = submitVote(current, {
        type: 'SubmitVote', commandId: `agent-cycle-${index}`, gameId: current.gameId,
        actorId, expectedRevision: current.revision,
        targetPlayerId: agentIds[(index + 1) % agentIds.length]!,
      }, { ids, clock });
      current = finalTransition.snapshot;
    }

    expect(current.status).toBe('awaiting_spectator');
    expect(current.players.find((player) => player.playerId === humanId)?.alive).toBe(false);
    expect(current.resumeAfterSpectating?.number).toBe(2);
    expect(current.resumeAfterSpectating?.actionType).toBe('describe');
    expect(finalTransition?.events.some((event) =>
      event.type === 'round_started' || event.type === 'turn_started')).toBe(false);

    const continued = continueSpectating(current, {
      type: 'ContinueSpectating', commandId: 'continue-after-vote-guess', gameId: current.gameId,
      actorId: humanId, expectedRevision: current.revision,
    }, { ids, clock });
    expect(continued.snapshot.phase).toBe('speaking');
    expect(continued.snapshot.round?.number).toBe(2);
    expect(continued.events.map((event) => event.type)).toEqual([
      'spectating_started', 'round_started', 'turn_started',
    ]);
  });
});
