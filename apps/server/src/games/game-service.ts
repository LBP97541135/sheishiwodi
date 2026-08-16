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
  terminateForSystemError as terminateForSystemErrorMachine,
  type AbandonGameCommand,
  type Clock,
  type ContinueSpectatingCommand,
  type CreateGameCommand,
  type GameSnapshot,
  type HumanGameView,
  type IdSource,
  type MachineDependencies,
  type MachineTransition,
  type PublicTimelineItem,
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
import { AgentSystemError } from '../agents/tokendance-agent-policy.js';
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
  private readonly backgroundAdvance: boolean;

  constructor(
    private readonly games: GameRepository,
    private readonly wordPairs: WordPairRepository,
    private readonly dependencies: {
      random: RandomSource;
      ids: IdSource;
      clock: Clock;
      agentPolicyFactory?: () => AgentPolicy;
      backgroundAdvance?: boolean;
    },
  ) {
    this.agentPolicyFactory = dependencies.agentPolicyFactory ?? (() => new FakeAgentPolicy());
    this.backgroundAdvance = dependencies.backgroundAdvance ?? false;
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

  async startGame(command: StartGameCommand): Promise<HumanGameView> {
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

    await this.settleAdvance(command.gameId);
    return this.games.getHumanView(command.gameId)!;
  }

  continueSpectating(command: ContinueSpectatingCommand): Promise<HumanGameView> {
    return this.applyHumanTransition(command, (snapshot) =>
      continueSpectatingMachine(snapshot, command, this.machineDeps()),
    );
  }

  abandonGame(command: AbandonGameCommand): Promise<HumanGameView> {
    return this.applyHumanTransition(command, (snapshot) =>
      abandonGameMachine(snapshot, command, this.machineDeps()),
    );
  }

  submitDescription(command: SubmitDescriptionCommand): Promise<HumanGameView> {
    return this.applyHumanTransition(command, (snapshot) =>
      submitDescriptionMachine(snapshot, command, this.machineDeps()),
    );
  }

  submitDefense(command: SubmitDefenseCommand): Promise<HumanGameView> {
    return this.applyHumanTransition(command, (snapshot) =>
      submitDefenseMachine(snapshot, command, this.machineDeps()),
    );
  }

  submitVote(command: SubmitVoteCommand): Promise<HumanGameView> {
    return this.applyHumanTransition(command, (snapshot) =>
      submitVoteMachine(snapshot, command, this.machineDeps()),
    );
  }

  async resumeActiveGame() {
    const active = this.games.findActiveSnapshot();
    if (active?.status === 'in_progress') {
      await this.advanceUntilHumanOrStop(active.gameId);
    }
  }

  async resumeGame(gameId: string) {
    await this.advanceUntilHumanOrStop(gameId);
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

  /** 存在进行中或待观战确认的对局时，禁止修改模型配置。preparing 与无局时允许。 */
  isGameLockedForConfig(): boolean {
    const active = this.games.findActiveSnapshot();
    return active?.status === 'in_progress' || active?.status === 'awaiting_spectator';
  }

  getGame(gameId: string) {
    const view = this.games.getHumanView(gameId);
    if (!view) {
      throw new GameServiceError('GAME_NOT_FOUND');
    }
    return view;
  }

  private async applyHumanTransition(
    command:
      | AbandonGameCommand
      | ContinueSpectatingCommand
      | SubmitDescriptionCommand
      | SubmitDefenseCommand
      | SubmitVoteCommand,
    produce: (snapshot: GameSnapshot) => MachineTransition,
  ): Promise<HumanGameView> {
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

    await this.settleAdvance(command.gameId);
    return this.games.getHumanView(command.gameId)!;
  }

  /**
   * 提交命令后驱动 AI 回合：运行时后台推进（立即返回，AI 回合异步跑、经 SSE 下发），
   * 测试同步 await（断言可确定读到已推进状态）。后台失败仅脱敏记日志，绝不外泄 Key/URL。
   */
  private async settleAdvance(gameId: string) {
    if (this.backgroundAdvance) {
      void this.advanceUntilHumanOrStop(gameId).catch((error: unknown) => {
        console.error('[advance] 后台推进失败：', error instanceof Error ? error.name : 'unknown');
      });
      return;
    }
    await this.advanceUntilHumanOrStop(gameId);
  }

  private async advanceUntilHumanOrStop(gameId: string) {
    if (this.advancingGames.has(gameId)) return;
    this.advancingGames.add(gameId);
    try {
      await this.runAdvanceLoop(gameId);
    } finally {
      this.advancingGames.delete(gameId);
    }
  }

  private async runAdvanceLoop(gameId: string) {
    const policy = this.agentPolicyFactory();
    // 投票/重投阶段的并行预取批次：描述必须串行，但同一阶段各票互不可见、互不依赖，
    // 可把“当前起、到第一个人类为止的连续 AI 投票者”的模型调用并行预取，再按机器顺序逐个提交。
    let voteBatch: Map<string, VoteActionOutput> | null = null;
    let batchCovers = new Set<string>();
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

      const isVotePhase = round.actionType === 'vote' || round.actionType === 'revote';
      if (isVotePhase && round.completedVoterIds.length === 0) {
        // 新一轮投票阶段开始，丢弃上一阶段可能残留的预取批次。
        voteBatch = null;
        batchCovers = new Set();
      }
      if (isVotePhase && !batchCovers.has(actor.playerId)) {
        const prefetched = await this.prefetchVoteBatch(gameId, snapshot, round, policy);
        voteBatch = prefetched.batch;
        batchCovers = prefetched.covers;
      }

      let output: SpeechActionOutput | VoteActionOutput;
      // 仅投票/重投阶段消费预取批次；辩解/描述绝不读它，避免把上一阶段的投票输出误当发言。
      const cached = isVotePhase ? voteBatch?.get(actor.playerId) : undefined;
      if (cached) {
        output = cached;
      } else {
        try {
          output = await policy.act(input, { agentRoleId: actor.agentRoleId ?? actor.playerId });
        } catch (error) {
          if (error instanceof AgentSystemError) {
            this.terminateForSystemError(gameId, snapshot, commandId, error.code, publicEvents);
            return;
          }
          throw error;
        }
      }

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

  /**
   * 并行预取一段“从当前投票者起、到第一个人类（或阶段末尾）为止的连续 AI 投票者”的模型输出。
   * 每票保密、互不依赖，可并行；返回的 covers 覆盖该连续段全部 AI（含调用失败者），
   * 调用者据此按机器顺序逐个提交；失败者不进 batch，交回普通串行路径触发既有系统终止逻辑。
   */
  private async prefetchVoteBatch(
    gameId: string,
    snapshot: GameSnapshot,
    round: NonNullable<GameSnapshot['round']>,
    policy: AgentPolicy,
  ): Promise<{ batch: Map<string, VoteActionOutput>; covers: Set<string> }> {
    const living = snapshot.players.filter((player) => player.alive);
    const isRevote = round.actionType === 'revote';
    const eligible = isRevote
      ? living.filter((player) => !round.tieCandidateIds.includes(player.playerId))
      : living;
    const startIdx = eligible.findIndex((player) => player.playerId === round.currentActorId);
    const run: typeof eligible = [];
    if (startIdx >= 0) {
      for (let index = startIdx; index < eligible.length; index += 1) {
        const player = eligible[index]!;
        if (round.completedVoterIds.includes(player.playerId)) continue;
        if (player.kind !== 'agent') break; // 遇到人类即停：其后 AI 留待人类投票后再并行预取，绝不预烧付费额度。
        run.push(player);
      }
    }
    const covers = new Set(run.map((player) => player.playerId));
    const batch = new Map<string, VoteActionOutput>();
    if (run.length < 2) return { batch, covers }; // 单个投票者无需并行，走普通串行路径。

    const publicEvents = this.games.listPublicTimeline(gameId);
    const settled = await Promise.allSettled(
      run.map(async (player) => {
        const priorBeliefs = this.games.listAgentBeliefs(gameId, player.playerId);
        const input = projectAgentTurnInput(snapshot, player.playerId, publicEvents, priorBeliefs);
        const output = await policy.act(input, { agentRoleId: player.agentRoleId ?? player.playerId });
        return { playerId: player.playerId, output };
      }),
    );
    for (const entry of settled) {
      if (entry.status === 'fulfilled') {
        batch.set(entry.value.playerId, entry.value.output as VoteActionOutput);
      }
    }
    return { batch, covers };
  }

  private terminateForSystemError(
    gameId: string,
    snapshot: GameSnapshot,
    failedActionId: string,
    errorType: string,
    publicEvents: readonly PublicTimelineItem[],
  ) {
    const commandId = `auto/${gameId}/${snapshot.revision}/system-terminated`;
    if (this.games.findProcessedCommand(commandId)) return;
    const transition = terminateForSystemErrorMachine(
      snapshot,
      {
        type: 'TerminateForSystemError',
        commandId,
        gameId,
        actorId: snapshot.humanPlayerId,
        expectedRevision: snapshot.revision,
        failedActionId,
        errorType,
      },
      this.machineDeps(),
    );
    const timeline = [...publicEvents, ...this.games.publicTimelineWith(transition.events)];
    const view = projectHumanGameView(transition.snapshot, timeline, undefined);
    this.games.commitTransition({
      previous: snapshot,
      snapshot: transition.snapshot,
      events: transition.events,
      commandId,
      requestHash: hashCommand({ commandId, errorType }),
      response: view,
    });
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
