import { createHash } from 'node:crypto';

import {
  abandonGame as abandonGameMachine,
  continueSpectating as continueSpectatingMachine,
  createPreparingGame,
  projectHumanGameView,
  startPreparingGame,
  submitDefense as submitDefenseMachine,
  submitDescription as submitDescriptionMachine,
  submitVote as submitVoteMachine,
  type AbandonGameCommand,
  type Clock,
  type ContinueSpectatingCommand,
  type CreateGameCommand,
  type GameSnapshot,
  type HumanGameView,
  type IdSource,
  type MachineDependencies,
  type MachineTransition,
  type RandomSource,
  type SpeechActionOutput,
  type StartGameCommand,
  type SubmitDefenseCommand,
  type SubmitDescriptionCommand,
  type SubmitVoteCommand,
  type VoteActionOutput,
} from '@sheishiwodi/shared';

import type { WordPairRepository } from '../db/word-pair-repository.js';
import { FakeAgentPolicy } from '../agents/fake-agent-policy.js';
import { projectAgentTurnInput } from '../agents/agent-input-projector.js';
import type { AgentPolicy } from '../agents/agent-policy.js';
import type { GameRepository, PublicStreamFrame } from './game-repository.js';

export type GameServiceErrorCode =
  | 'ACTIVE_GAME_EXISTS'
  | 'ACTOR_NOT_ALLOWED'
  | 'CONTENT_REJECTED'
  | 'GAME_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'REVISION_CONFLICT';

export class GameServiceError extends Error {
  constructor(public readonly code: GameServiceErrorCode) {
    super(code);
  }
}

export class GameService {
  private readonly agentPolicyFactory: () => AgentPolicy;
  private readonly advancingGames = new Set<string>();

  constructor(
    private readonly games: GameRepository,
    private readonly wordPairs: WordPairRepository,
    private readonly dependencies: {
      random: RandomSource;
      ids: IdSource;
      clock: Clock;
      agentPolicyFactory?: () => AgentPolicy;
    },
  ) {
    this.agentPolicyFactory = dependencies.agentPolicyFactory ?? (() => new FakeAgentPolicy());
  }

  createGame(command: CreateGameCommand): HumanGameView {
    const requestHash = hashCommand(command);
    const processed = this.games.findProcessedCommand(command.commandId);
    if (processed) {
      if (processed.requestHash !== requestHash) {
        throw new GameServiceError('IDEMPOTENCY_CONFLICT');
      }
      return processed.response;
    }
    if (this.games.findActiveSnapshot()) {
      throw new GameServiceError('ACTIVE_GAME_EXISTS');
    }

    const transition = createPreparingGame(
      command,
      this.wordPairs.listEnabled(command.difficulty),
      this.dependencies,
    );
    const view = projectHumanGameView(transition.snapshot);

    try {
      this.games.saveCreated(
        transition.snapshot,
        transition.events,
        command.commandId,
        requestHash,
        view,
      );
    } catch (error) {
      if (isSqliteConstraint(error)) {
        throw new GameServiceError('ACTIVE_GAME_EXISTS');
      }
      throw error;
    }

    return view;
  }

  startGame(command: StartGameCommand): HumanGameView {
    const requestHash = hashCommand(command);
    const processed = this.games.findProcessedCommand(command.commandId);
    if (processed) {
      if (processed.requestHash !== requestHash) {
        throw new GameServiceError('IDEMPOTENCY_CONFLICT');
      }
      return processed.response;
    }

    const current = this.games.findSnapshot(command.gameId);
    if (!current) {
      throw new GameServiceError('GAME_NOT_FOUND');
    }

    try {
      const transition = startPreparingGame(current, command, this.dependencies);
      const timeline = [
        ...this.games.publicTimelineWith([]),
        ...this.games.publicTimelineWith(transition.events),
      ];
      const view = projectHumanGameView(transition.snapshot, timeline);
      this.games.saveStarted(
        current,
        transition.snapshot,
        transition.events,
        command.commandId,
        requestHash,
        view,
      );
    } catch (error) {
      throw mapMachineError(error);
    }

    this.advanceUntilHumanOrStop(command.gameId);
    return this.games.getHumanView(command.gameId)!;
  }

  continueSpectating(command: ContinueSpectatingCommand): HumanGameView {
    return this.applyHumanTransition(command, (snapshot) =>
      continueSpectatingMachine(snapshot, command, this.machineDeps()),
    );
  }

  abandonGame(command: AbandonGameCommand): HumanGameView {
    return this.applyHumanTransition(command, (snapshot) =>
      abandonGameMachine(snapshot, command, this.machineDeps()),
    );
  }

  submitDescription(command: SubmitDescriptionCommand): HumanGameView {
    return this.applyHumanTransition(command, (snapshot) =>
      submitDescriptionMachine(snapshot, command, this.machineDeps()),
    );
  }

  submitDefense(command: SubmitDefenseCommand): HumanGameView {
    return this.applyHumanTransition(command, (snapshot) =>
      submitDefenseMachine(snapshot, command, this.machineDeps()),
    );
  }

  submitVote(command: SubmitVoteCommand): HumanGameView {
    return this.applyHumanTransition(command, (snapshot) =>
      submitVoteMachine(snapshot, command, this.machineDeps()),
    );
  }

  resumeActiveGame() {
    const active = this.games.findActiveSnapshot();
    if (active?.status === 'in_progress') {
      this.advanceUntilHumanOrStop(active.gameId);
    }
  }

  resumeGame(gameId: string) {
    this.advanceUntilHumanOrStop(gameId);
  }

  getEvents(gameId: string, after: number): { frames: PublicStreamFrame[]; eventCursor: number } {
    const snapshot = this.games.findSnapshot(gameId);
    if (!snapshot) {
      throw new GameServiceError('GAME_NOT_FOUND');
    }
    return { frames: this.games.listPublicFramesAfter(gameId, after), eventCursor: snapshot.streamSeq };
  }

  getActiveGame() {
    const active = this.games.findActiveSnapshot();
    return active ? this.games.getHumanView(active.gameId) : null;
  }

  getGame(gameId: string) {
    const view = this.games.getHumanView(gameId);
    if (!view) {
      throw new GameServiceError('GAME_NOT_FOUND');
    }
    return view;
  }

  private applyHumanTransition(
    command:
      | AbandonGameCommand
      | ContinueSpectatingCommand
      | SubmitDescriptionCommand
      | SubmitDefenseCommand
      | SubmitVoteCommand,
    produce: (snapshot: GameSnapshot) => MachineTransition,
  ): HumanGameView {
    const requestHash = hashCommand(command);
    const processed = this.games.findProcessedCommand(command.commandId);
    if (processed) {
      if (processed.requestHash !== requestHash) {
        throw new GameServiceError('IDEMPOTENCY_CONFLICT');
      }
      return processed.response;
    }

    const current = this.games.findSnapshot(command.gameId);
    if (!current) {
      throw new GameServiceError('GAME_NOT_FOUND');
    }

    try {
      const transition = produce(current);
      const timeline = [
        ...this.games.listPublicTimeline(command.gameId),
        ...this.games.publicTimelineWith(transition.events),
      ];
      const view = projectHumanGameView(
        transition.snapshot,
        timeline,
        transition.snapshot.status === 'finished'
          ? this.games.getFactReview(command.gameId)
          : undefined,
      );
      this.games.commitTransition({
        previous: current,
        snapshot: transition.snapshot,
        events: transition.events,
        commandId: command.commandId,
        requestHash,
        response: view,
      });
    } catch (error) {
      throw mapMachineError(error);
    }

    this.advanceUntilHumanOrStop(command.gameId);
    return this.games.getHumanView(command.gameId)!;
  }

  private advanceUntilHumanOrStop(gameId: string) {
    if (this.advancingGames.has(gameId)) return;
    this.advancingGames.add(gameId);
    try {
      this.runAdvanceLoop(gameId);
    } finally {
      this.advancingGames.delete(gameId);
    }
  }

  private runAdvanceLoop(gameId: string) {
    const policy = this.agentPolicyFactory();
    for (let guard = 0; guard < 500; guard += 1) {
      const snapshot = this.games.findSnapshot(gameId);
      if (!snapshot || snapshot.status !== 'in_progress' || !snapshot.round) {
        return;
      }
      const round = snapshot.round;
      const actor = snapshot.players.find((player) => player.playerId === round.currentActorId);
      if (!actor || !actor.alive || actor.kind !== 'agent') {
        return;
      }
      if (
        round.actionType !== 'describe' &&
        round.actionType !== 'defend' &&
        round.actionType !== 'vote' &&
        round.actionType !== 'revote'
      ) {
        return;
      }

      const commandId = `auto/${gameId}/${snapshot.revision}/${actor.playerId}/${round.actionType}`;
      if (this.games.findProcessedCommand(commandId)) {
        return;
      }

      const priorBeliefs = this.games.listAgentBeliefs(gameId, actor.playerId);
      const publicEvents = this.games.listPublicTimeline(gameId);
      const input = projectAgentTurnInput(snapshot, actor.playerId, publicEvents, priorBeliefs);
      const output = policy.act(input);

      let transition: MachineTransition;
      let outputRecord: Record<string, unknown>;
      if (round.actionType === 'describe' || round.actionType === 'defend') {
        const speech = output as SpeechActionOutput;
        if (round.actionType === 'describe') {
          transition = submitDescriptionMachine(
            snapshot,
            {
              type: 'SubmitDescription',
              commandId,
              gameId,
              actorId: actor.playerId,
              expectedRevision: snapshot.revision,
              text: speech.text,
            },
            this.machineDeps(),
          );
        } else {
          transition = submitDefenseMachine(
            snapshot,
            {
              type: 'SubmitDefense',
              commandId,
              gameId,
              actorId: actor.playerId,
              expectedRevision: snapshot.revision,
              text: speech.text,
            },
            this.machineDeps(),
          );
        }
        outputRecord = { text: speech.text };
      } else {
        const vote = output as VoteActionOutput;
        transition = submitVoteMachine(
          snapshot,
          {
            type: 'SubmitVote',
            commandId,
            gameId,
            actorId: actor.playerId,
            expectedRevision: snapshot.revision,
            targetPlayerId: vote.targetPlayerId,
          },
          this.machineDeps(),
        );
        outputRecord = { targetPlayerId: vote.targetPlayerId, reason: vote.reason };
      }

      const timeline = [...publicEvents, ...this.games.publicTimelineWith(transition.events)];
      const privateAction = {
        actionId: commandId,
        playerId: actor.playerId,
        roundNumber: round.number,
        actionType: round.actionType,
        baseRevision: snapshot.revision,
        belief: output.belief,
        output: outputRecord,
        completedAt: transition.snapshot.updatedAt,
      };
      const persistedFactReview =
        transition.snapshot.status === 'finished'
          ? this.games.getFactReview(gameId)
          : undefined;
      const view = projectHumanGameView(
        transition.snapshot,
        timeline,
        persistedFactReview
          ? { agentActions: [...persistedFactReview.agentActions, privateAction] }
          : undefined,
      );
      this.games.commitTransition({
        previous: snapshot,
        snapshot: transition.snapshot,
        events: transition.events,
        commandId,
        requestHash: hashCommand({ commandId, actionType: round.actionType }),
        response: view,
        privateAction,
      });
    }
  }

  private machineDeps(): MachineDependencies {
    return { ids: this.dependencies.ids, clock: this.dependencies.clock };
  }
}

const hashCommand = (command: object) =>
  createHash('sha256').update(JSON.stringify(command)).digest('hex');

const isSqliteConstraint = (error: unknown) =>
  error instanceof Error && error.message.includes('UNIQUE constraint failed');

const mapMachineError = (error: unknown): unknown => {
  if (error instanceof GameServiceError) {
    return error;
  }
  if (error instanceof Error) {
    if (error.message.startsWith('CONTENT_REJECTED')) {
      return new GameServiceError('CONTENT_REJECTED');
    }
    if (
      ['ACTOR_NOT_ALLOWED', 'INVALID_TRANSITION', 'REVISION_CONFLICT', 'GAME_NOT_FOUND'].includes(
        error.message,
      )
    ) {
      return new GameServiceError(error.message as GameServiceErrorCode);
    }
  }
  return error;
};
