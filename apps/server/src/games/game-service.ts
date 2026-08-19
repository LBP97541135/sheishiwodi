import { createHash } from 'node:crypto';

import {
  abandonGame as abandonGameMachine,
  continueSpectating as continueSpectatingMachine,
  createPreparingGame,
  declineInterruptedGame,
  disqualifyPlayerForRuleViolation as disqualifyPlayerForRuleViolationMachine,
  projectHumanGameView,
  startPreparingGame,
  submitDefense as submitDefenseMachine,
  submitDescription as submitDescriptionMachine,
  submitVote as submitVoteMachine,
  terminateForSystemError as terminateForSystemErrorMachine,
  validatePublicSpeech,
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
  type ResolveInterruptedGameRequest,
  type SpeechActionOutput,
  type StartGameCommand,
  type SubmitDefenseCommand,
  type SubmitDescriptionCommand,
  type SubmitVoteCommand,
  type VoteActionOutput,
} from '@sheishiwodi/shared';

import type { WordPairRepository } from '../db/word-pair-repository.js';
import {
  AgentContextAssembler,
  type AgentContextProvenance,
} from '../agents/agent-context-assembler.js';
import { FakeAgentPolicy } from '../agents/fake-agent-policy.js';
import type { AgentPolicy } from '../agents/agent-policy.js';
import { AgentSystemError } from '../agents/tokendance-agent-policy.js';
import type { GameRepository, PublicStreamFrame } from './game-repository.js';
import type { GameRecoveryRepository } from './game-recovery-repository.js';

export type GameServiceErrorCode =
  | 'ACTIVE_GAME_EXISTS'
  | 'ACTOR_NOT_ALLOWED'
  | 'CONTENT_REJECTED'
  | 'GAME_NOT_FOUND'
  | 'IDEMPOTENCY_CONFLICT'
  | 'INVALID_TRANSITION'
  | 'MODEL_CONFIGURATION_REQUIRED'
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
  private readonly areRequiredModelsConfigured: () => boolean;
  private readonly agentContexts: AgentContextAssembler;

  constructor(
    private readonly games: GameRepository,
    private readonly wordPairs: WordPairRepository,
    private readonly dependencies: {
      random: RandomSource;
      ids: IdSource;
      clock: Clock;
      agentPolicyFactory?: () => AgentPolicy;
      backgroundAdvance?: boolean;
      /** 通用真实 provider 的角色与复盘模型配置门禁；假模型与 Tokendance 默认放行。 */
      areRequiredModelsConfigured?: () => boolean;
      /** 正常终局后回调（用于触发赛后复盘异步生成）。幂等，失败不得影响主流程。 */
      onGameFinished?: (gameId: string) => void;
      /** 对局活动状态变化后唤醒低优先级后台调度。 */
      onGameActivityChanged?: () => void;
    },
    private readonly recovery?: GameRecoveryRepository,
  ) {
    this.agentPolicyFactory = dependencies.agentPolicyFactory ?? (() => new FakeAgentPolicy());
    this.backgroundAdvance = dependencies.backgroundAdvance ?? false;
    this.areRequiredModelsConfigured = dependencies.areRequiredModelsConfigured ?? (() => true);
    this.agentContexts = new AgentContextAssembler(games);
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

    this.dependencies.onGameActivityChanged?.();
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
    if (!this.areRequiredModelsConfigured()) {
      throw new GameServiceError('MODEL_CONFIGURATION_REQUIRED');
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

    await this.settleAdvance(command.gameId, command.commandId);
    return this.decorateRecovery(this.games.getHumanView(command.gameId)!);
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
    if (active?.status === 'in_progress' && !this.recovery?.getAwaiting(active.gameId)) {
      await this.advanceUntilHumanOrStop(
        active.gameId,
        `resume/${active.gameId}/${active.revision}`,
      );
    }
  }

  async resumeGame(gameId: string) {
    const snapshot = this.games.findSnapshot(gameId);
    await this.advanceUntilHumanOrStop(gameId, `resume/${gameId}/${snapshot?.revision ?? 0}`);
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
    const view = active ? this.games.getHumanView(active.gameId) : null;
    return view ? this.decorateRecovery(view) : null;
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
    return this.decorateRecovery(view);
  }

  async resolveInterruptedGame(
    gameId: string,
    request: ResolveInterruptedGameRequest,
  ): Promise<HumanGameView> {
    const snapshot = this.games.findSnapshot(gameId);
    if (!snapshot) throw new GameServiceError('GAME_NOT_FOUND');
    const recovery = this.recovery;
    const interruption = recovery?.getAwaiting(gameId);
    if (!recovery || !interruption || snapshot.status !== 'in_progress') {
      throw new GameServiceError('INVALID_TRANSITION');
    }

    if (request.resolution === 'continue') {
      if (!recovery.resolve(gameId, 'continue', this.dependencies.clock.now())) {
        throw new GameServiceError('INVALID_TRANSITION');
      }
      await this.settleAdvance(gameId, request.commandId);
      this.dependencies.onGameActivityChanged?.();
      return this.decorateRecovery(this.games.getHumanView(gameId)!);
    }

    const transition = declineInterruptedGame(
      snapshot,
      {
        type: 'ResolveInterruptedGame',
        commandId: request.commandId,
        gameId,
        actorId: snapshot.humanPlayerId,
        expectedRevision: snapshot.revision,
        resolution: 'start_new',
      },
      this.machineDeps(),
    );
    const timeline = [
      ...this.games.listPublicTimeline(gameId),
      ...this.games.publicTimelineWith(transition.events),
    ];
    const view = projectHumanGameView(transition.snapshot, timeline);
    this.games.commitTransition({
      previous: snapshot,
      snapshot: transition.snapshot,
      events: transition.events,
      commandId: request.commandId,
      requestHash: hashCommand({ gameId, ...request }),
      response: view,
    });
    recovery.resolve(gameId, 'start_new', this.dependencies.clock.now());
    this.dependencies.onGameActivityChanged?.();
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
      this.notifyIfFinished(transition.snapshot);
    } catch (error) {
      throw mapMachineError(error);
    }

    await this.settleAdvance(command.gameId, command.commandId);
    this.dependencies.onGameActivityChanged?.();
    return this.decorateRecovery(this.games.getHumanView(command.gameId)!);
  }

  private decorateRecovery(view: HumanGameView): HumanGameView {
    if (view.status !== 'in_progress' || !this.recovery?.getAwaiting(view.gameId)) return view;
    return {
      ...view,
      allowedCommands: ['ResolveInterruptedGame'],
      operationalStatus: { state: 'interrupted' },
    };
  }

  /**
   * 提交命令后驱动 AI 回合：运行时后台推进（立即返回，AI 回合异步跑、经 SSE 下发），
   * 测试同步 await（断言可确定读到已推进状态）。后台失败仅脱敏记日志，绝不外泄 Key/URL。
   */
  private async settleAdvance(gameId: string, rootCommandId: string) {
    if (this.backgroundAdvance) {
      void this.advanceUntilHumanOrStop(gameId, rootCommandId).catch((error: unknown) => {
        console.error('[advance] 后台推进失败：', error instanceof Error ? error.name : 'unknown');
      });
      return;
    }
    await this.advanceUntilHumanOrStop(gameId, rootCommandId);
  }

  private async advanceUntilHumanOrStop(gameId: string, rootCommandId: string) {
    if (this.advancingGames.has(gameId)) return;
    this.advancingGames.add(gameId);
    try {
      await this.runAdvanceLoop(gameId, rootCommandId);
    } finally {
      this.advancingGames.delete(gameId);
    }
  }

  private async runAdvanceLoop(gameId: string, rootCommandId: string) {
    const policy = this.agentPolicyFactory();
    // 投票/重投阶段的并行预取批次：描述必须串行，但同一阶段各票互不可见、互不依赖，
    // 可把“当前起、到第一个人类为止的连续 AI 投票者”的模型调用并行预取，再按机器顺序逐个提交。
    let voteBatch: Map<string, VoteActionOutput> | null = null;
    let batchCovers = new Set<string>();
    let voteFailures = new Map<string, unknown>();
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

      const publicEvents = this.games.listPublicTimeline(gameId);
      const { input, provenance } = this.agentContexts.assemble(snapshot, actor.playerId);

      const isVotePhase = round.actionType === 'vote' || round.actionType === 'revote';
      if (isVotePhase && round.completedVoterIds.length === 0) {
        // 新一轮投票阶段开始，丢弃上一阶段可能残留的预取批次。
        voteBatch = null;
        batchCovers = new Set();
        voteFailures = new Map();
      }
      if (isVotePhase && !batchCovers.has(actor.playerId)) {
        const prefetched = await this.prefetchVoteBatch(
          gameId,
          snapshot,
          round,
          policy,
          rootCommandId,
        );
        voteBatch = prefetched.batch;
        batchCovers = prefetched.covers;
        voteFailures = prefetched.failures;
      }

      let output: SpeechActionOutput | VoteActionOutput | undefined;
      // 仅投票/重投阶段消费预取批次；辩解/描述绝不读它，避免把上一阶段的投票输出误当发言。
      const cached = isVotePhase ? voteBatch?.get(actor.playerId) : undefined;
      const cachedFailure = isVotePhase ? voteFailures.get(actor.playerId) : undefined;
      if (cachedFailure) {
        if (cachedFailure instanceof AgentSystemError) {
          this.terminateForSystemError(gameId, snapshot, commandId, cachedFailure.code, publicEvents);
          return;
        }
        throw cachedFailure;
      }
      if (cached) {
        output = cached;
      } else {
        let contentRetry: 'format' | 'word_leak' | undefined;
        let contentFailureCount = 0;
        let wordLeakCount = 0;
        for (;;) {
          try {
            output = await policy.act(input, {
              agentRoleId: actor.agentRoleId ?? actor.playerId,
              ...(contentRetry ? { contentRetry } : {}),
              trace: this.agentTrace(
                gameId,
                rootCommandId,
                commandId,
                provenance,
              ),
            });
          } catch (error) {
            if (error instanceof AgentSystemError) {
              this.terminateForSystemError(gameId, snapshot, commandId, error.code, publicEvents);
              return;
            }
            // 未分类异常可能是进程/程序故障，不能伪装成模型错误并永久终止；
            // 保留当前 revision，允许既有启动恢复机制在服务重启后继续。
            throw error;
          }

          const latest = this.games.findSnapshot(gameId);
          if (
            !latest ||
            latest.status !== 'in_progress' ||
            latest.revision !== snapshot.revision ||
            latest.round?.currentActorId !== actor.playerId ||
            latest.round.actionType !== round.actionType
          ) {
            // 模型调用期间人类可能放弃或状态已由其他执行者推进；旧结果直接作废。
            output = undefined;
            break;
          }

          if (round.actionType !== 'describe' && round.actionType !== 'defend') break;
          const speech = output as SpeechActionOutput;
          const validation = validatePublicSpeech(speech.text, actor.wordCard);
          if (validation.valid) break;

          contentFailureCount += 1;
          if (validation.code === 'WORD_LEAK') {
            wordLeakCount += 1;
            if (wordLeakCount >= 2) {
              this.disqualifyForWordLeak(gameId, snapshot, actor.playerId, commandId, publicEvents);
              output = undefined;
              break;
            }
            contentRetry = 'word_leak';
            continue;
          }

          if (contentFailureCount >= 2) {
            this.terminateForSystemError(gameId, snapshot, commandId, 'CONTENT_INVALID', publicEvents);
            return;
          }
          contentRetry = 'format';
        }
      }

      if (!output) continue;

      const latestBeforeCommit = this.games.findSnapshot(gameId);
      if (
        !latestBeforeCommit ||
        latestBeforeCommit.status !== 'in_progress' ||
        latestBeforeCommit.revision !== snapshot.revision ||
        latestBeforeCommit.round?.currentActorId !== actor.playerId ||
        latestBeforeCommit.round.actionType !== round.actionType
      ) {
        continue;
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
      try {
        this.commitTransitionWithRetry({
          previous: snapshot,
          snapshot: transition.snapshot,
          events: transition.events,
          commandId,
          requestHash: hashCommand({ commandId, actionType: round.actionType }),
          response: view,
          privateAction,
        });
      } catch (error) {
        if (error instanceof Error && error.message === 'REVISION_CONFLICT') continue;
        const latest = this.games.findSnapshot(gameId);
        if (latest?.status === 'in_progress') {
          this.terminateForSystemError(
            gameId,
            latest,
            commandId,
            'INTERNAL_ERROR',
            this.games.listPublicTimeline(gameId),
          );
        }
        return;
      }
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
    rootCommandId: string,
  ): Promise<{
    batch: Map<string, VoteActionOutput>;
    covers: Set<string>;
    failures: Map<string, unknown>;
  }> {
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
    const failures = new Map<string, unknown>();
    if (run.length < 2) return { batch, covers, failures }; // 单个投票者无需并行，走普通串行路径。

    const settled = await Promise.allSettled(
      run.map(async (player, index) => {
        const { input, provenance } = this.agentContexts.assemble(snapshot, player.playerId);
        const actionId = `auto/${gameId}/${snapshot.revision + index}/${player.playerId}/${round.actionType}`;
        const output = await policy.act(input, {
          agentRoleId: player.agentRoleId ?? player.playerId,
          trace: this.agentTrace(
            gameId,
            rootCommandId,
            actionId,
            provenance,
          ),
        });
        return { playerId: player.playerId, output };
      }),
    );
    settled.forEach((entry, index) => {
      if (entry.status === 'fulfilled') {
        batch.set(entry.value.playerId, entry.value.output as VoteActionOutput);
      } else {
        failures.set(run[index]!.playerId, entry.reason);
      }
    });
    return { batch, covers, failures };
  }

  private agentTrace(
    gameId: string,
    commandId: string,
    actionId: string,
    provenance: AgentContextProvenance,
  ) {
    return {
      gameId,
      commandId,
      actionId,
      provenance,
    };
  }

  private disqualifyForWordLeak(
    gameId: string,
    snapshot: GameSnapshot,
    playerId: string,
    failedActionId: string,
    publicEvents: readonly PublicTimelineItem[],
  ) {
    const commandId = `${failedActionId}/rule-violation`;
    if (this.games.findProcessedCommand(commandId)) return;
    const transition = disqualifyPlayerForRuleViolationMachine(
      snapshot,
      {
        type: 'DisqualifyPlayerForRuleViolation',
        commandId,
        gameId,
        actorId: playerId,
        expectedRevision: snapshot.revision,
        failedActionId,
        rule: 'word_leak',
      },
      this.machineDeps(),
    );
    const timeline = [...publicEvents, ...this.games.publicTimelineWith(transition.events)];
    const view = projectHumanGameView(
      transition.snapshot,
      timeline,
      transition.snapshot.status === 'finished' ? this.games.getFactReview(gameId) : undefined,
    );
    this.commitTransitionWithRetry({
      previous: snapshot,
      snapshot: transition.snapshot,
      events: transition.events,
      commandId,
      requestHash: hashCommand({ commandId, rule: 'word_leak' }),
      response: view,
    });
  }

  private commitTransitionWithRetry(input: Parameters<GameRepository['commitTransition']>[0]) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        this.games.commitTransition(input);
        this.notifyIfFinished(input.snapshot);
        return;
      } catch (error) {
        lastError = error;
        if (isSqliteBusy(error)) throw error;
        if (error instanceof Error && error.message === 'REVISION_CONFLICT') throw error;
      }
    }
    throw lastError;
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
    this.commitTransitionWithRetry({
      previous: snapshot,
      snapshot: transition.snapshot,
      events: transition.events,
      commandId,
      requestHash: hashCommand({ commandId, errorType }),
      response: view,
    });
  }

  /** 正常终局（status==='finished' 隐含带 reveal/factReview）时触发复盘回调；异常终局不触发。 */
  private notifyIfFinished(snapshot: GameSnapshot) {
    this.dependencies.onGameActivityChanged?.();
    if (snapshot.status !== 'finished') return;
    try {
      this.dependencies.onGameFinished?.(snapshot.gameId);
    } catch (error) {
      console.error('[review] 终局回调失败：', error instanceof Error ? error.name : 'unknown');
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

const isSqliteBusy = (error: unknown) =>
  error instanceof Error &&
  ('code' in error ? error.code === 'SQLITE_BUSY' : error.message.includes('database is locked'));

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
