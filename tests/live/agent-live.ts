// 分层真实模型验收编排器（tsx 运行）。默认跑“策略级”真实调用；带 full 令牌或
// LIVE_FULL_GAME=1 追加“可选整局”。聚合脱敏记录并落盘 Markdown 报告。
// 硬边界：仅经 pnpm test:live* 触发；缺 env 显式失败退出码 1；输出/报告全程脱敏。

import {
  agentRoleIds,
  continueSpectating,
  createPreparingGame,
  findAgentRole,
  speechActionOutputSchema,
  startPreparingGame,
  submitDefense,
  submitDescription,
  submitVote,
  terminateForSystemError,
  validateBeliefSnapshot,
  voteActionOutputSchema,
  type AgentTurnInput,
  type Clock,
  type GameEvent,
  type GameSnapshot,
  type IdSource,
  type PublicTimelineItem,
  type RandomSource,
  type SpeechActionOutput,
  type VoteActionOutput,
} from '@sheishiwodi/shared';

import { projectAgentTurnInput } from '../../apps/server/src/agents/agent-input-projector.js';
import { TokendanceClient } from '../../apps/server/src/agents/tokendance-client.js';
import {
  AgentSystemError,
  TokendanceAgentPolicy,
} from '../../apps/server/src/agents/tokendance-agent-policy.js';
import type { ServerDependencies } from '../../apps/server/src/server.js';

import { LiveGateError, resolveLiveConfig, type LiveConfig } from './lib/env.js';
import {
  BELIEF_INTERNAL_SENTINELS,
  CAMP_SENTINELS,
  credentialSentinels,
  scan,
  wordSentinels,
} from './lib/isolation.js';
import {
  allWordCards,
  buildDescribeInput,
  buildStartedSnapshot,
  buildVoteInput,
  otherWordCards,
  pickAgentForRole,
} from './lib/inputs.js';
import {
  ReportLeakError,
  timestampStamp,
  writeReport,
  type ErrorRecord,
  type FullGameRecord,
  type IsolationRecord,
  type PolicyRecord,
} from './lib/report.js';

// —— 脱敏计时采集：截获策略 debug 打印的 `[agent] …` 行，绝不含 Key/URL/响应正文。——
const timingLines: string[] = [];
const originalInfo = console.info.bind(console);
console.info = (...args: unknown[]): void => {
  const text = args.map((value) => String(value)).join(' ');
  if (text.startsWith('[agent]')) timingLines.push(text);
  originalInfo(...(args as []));
};

function parseTiming(lines: readonly string[]): {
  elapsedMs: number | null;
  retries: number | null;
  repairUsed: boolean | null;
} {
  if (lines.length === 0) return { elapsedMs: null, retries: null, repairUsed: null };
  const last = lines[lines.length - 1]!;
  const match = /(\d+)ms$/.exec(last);
  return {
    elapsedMs: match ? Number(match[1]) : null,
    retries: lines.length - 1,
    repairUsed: lines.some((line) => line.includes('repair=true')),
  };
}

const policyRecords: PolicyRecord[] = [];
const isolationRecords: IsolationRecord[] = [];
const errorRecords: ErrorRecord[] = [];

function livingIds(input: AgentTurnInput): string[] {
  return input.players.filter((player) => player.alive).map((player) => player.playerId);
}

// 脱敏错误码：AgentSystemError/TokendanceError 的 message 已是 AGENT_SYSTEM_* / TOKENDANCE_* 前缀。
function errorCodeOf(error: unknown): string {
  if (error instanceof AgentSystemError) return error.message;
  if (error instanceof Error && /^TOKENDANCE_/.test(error.message)) return error.message;
  if (error instanceof Error && /^(AGENT_SYSTEM_|BELIEF_)/.test(error.message)) return error.message;
  return 'UNEXPECTED_ERROR';
}

interface PolicyActArgs {
  policy: TokendanceAgentPolicy;
  roleId: string;
  action: 'describe' | 'vote';
  input: AgentTurnInput;
  otherWords: readonly string[];
  credentials: ReturnType<typeof credentialSentinels>;
}

async function runPolicyAct(args: PolicyActArgs): Promise<void> {
  const { policy, roleId, action, input, otherWords, credentials } = args;
  timingLines.length = 0;

  let output: SpeechActionOutput | VoteActionOutput;
  try {
    output = await policy.act(input, { agentRoleId: roleId });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    // 错误消息通道隔离：脱敏错误码不得含 Base URL / Key / 授权头。
    isolationRecords.push(...scan('errorMessage', message, [credentials]));
    errorRecords.push({ role: roleId, action, code: errorCodeOf(error) });
    return;
  }

  const timing = parseTiming(timingLines);

  let schemaPass = true;
  let beliefPass = true;
  let targetLegal: boolean | null = action === 'vote' ? false : null;
  try {
    if (action === 'describe') {
      speechActionOutputSchema.parse(output);
    } else {
      const vote = voteActionOutputSchema.parse(output) as VoteActionOutput;
      targetLegal = input.legalTargets.includes(vote.targetPlayerId);
    }
  } catch {
    schemaPass = false;
  }
  try {
    validateBeliefSnapshot(output.belief, livingIds(input), input.publicConfig.undercoverCount);
  } catch {
    beliefPass = false;
  }

  const publicText =
    action === 'describe'
      ? (output as SpeechActionOutput).text
      : (output as VoteActionOutput).reason;
  const ownWordWarn = publicText.includes(input.actor.ownWordCard);

  // 通道隔离：agent 输入（自己的词牌允许）、策略公开文本（他人词牌 + 内部字段不得出现）。
  const inputSerialized = JSON.stringify(input);
  const inputCats = [credentials, CAMP_SENTINELS, BELIEF_INTERNAL_SENTINELS, ...wordSentinels(otherWords)];
  isolationRecords.push(...scan(`agentInput:${action}`, inputSerialized, inputCats));

  const publicCats = [credentials, CAMP_SENTINELS, BELIEF_INTERNAL_SENTINELS, ...wordSentinels(otherWords)];
  isolationRecords.push(...scan(`publicText:${action}`, publicText, publicCats));

  policyRecords.push({
    role: roleId,
    model: policyModelFor(roleId),
    action,
    schemaPass,
    beliefPass,
    targetLegal,
    elapsedMs: timing.elapsedMs,
    retries: timing.retries,
    repairUsed: timing.repairUsed,
    ownWordWarn,
  });
}

const resolvedModels: Record<string, string> = {};
function policyModelFor(roleId: string): string {
  return resolvedModels[roleId] ?? '(unknown)';
}

async function runPolicyLevel(config: LiveConfig, client: TokendanceClient): Promise<void> {
  const snapshot = buildStartedSnapshot();
  const credentials = credentialSentinels(config.baseUrl, config.apiKey);

  for (const roleId of agentRoleIds) {
    const modelId = findAgentRole(roleId)?.defaultModelId ?? config.defaultModel;
    if (!modelId) {
      errorRecords.push({ role: roleId, action: '*', code: 'AGENT_SYSTEM_MODEL_NOT_CONFIGURED' });
      continue;
    }
    resolvedModels[roleId] = modelId;

    const policy = new TokendanceAgentPolicy({
      client,
      roleModelMap: { [roleId]: modelId },
      maxSystemRetries: config.maxRetries,
      retryDelayMs: config.retryDelayMs,
      debug: true,
    });
    const actor = pickAgentForRole(snapshot, roleId);
    const otherWords = otherWordCards(snapshot, actor.playerId);

    for (let sample = 0; sample < config.samples; sample += 1) {
      await runPolicyAct({
        policy,
        roleId,
        action: 'describe',
        input: buildDescribeInput(snapshot, actor.playerId),
        otherWords,
        credentials,
      });
    }
    await runPolicyAct({
      policy,
      roleId,
      action: 'vote',
      input: buildVoteInput(snapshot, actor.playerId),
      otherWords,
      credentials,
    });
  }
}

// —— 可选整局：动态导入服务端（含 better-sqlite3/Fastify），策略级路径不受牵连。——
interface InjectResponse {
  statusCode: number;
  body: string;
  json: () => unknown;
}
interface TestServer {
  inject: (options: { method: string; url: string; payload?: unknown }) => Promise<InjectResponse>;
  close: () => Promise<void>;
}
interface GameView {
  gameId: string;
  status: string;
  phase: string;
  revision: number;
  round: { number: number; currentActorId: string | null; actionType: string | null } | null;
  legalVoteTargetIds: string[];
  human: { playerId: string };
}

const dataOf = (response: InjectResponse): GameView => (response.json() as { data: GameView }).data;

async function createGame(server: TestServer): Promise<GameView> {
  const created = await server.inject({
    method: 'POST',
    url: '/api/games',
    payload: {
      commandId: 'live-create-1',
      human: { displayName: '小祎', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
  });
  const view = dataOf(created);
  await server.inject({
    method: 'POST',
    url: `/api/games/${view.gameId}/start`,
    payload: { commandId: 'live-start-1', actorId: view.human.playerId, expectedRevision: view.revision },
  });
  return view;
}

async function getView(server: TestServer, gameId: string): Promise<GameView> {
  return dataOf(await server.inject({ method: 'GET', url: `/api/games/${gameId}` }));
}

async function driveHumanToEnd(
  server: TestServer,
  gameId: string,
  humanId: string,
): Promise<GameView> {
  for (let step = 0; step < 80; step += 1) {
    const view = await getView(server, gameId);
    if (view.status === 'awaiting_spectator') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/spectate`,
        payload: { commandId: `live-spectate-${step}`, actorId: humanId, expectedRevision: view.revision },
      });
      continue;
    }
    if (view.status !== 'in_progress') return view;
    if (view.round?.currentActorId !== humanId) return view;
    if (view.round.actionType === 'describe') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/descriptions`,
        payload: {
          commandId: `live-describe-${step}`,
          actorId: humanId,
          expectedRevision: view.revision,
          text: '这是一个很普通的东西',
        },
      });
    } else if (view.round.actionType === 'vote') {
      await server.inject({
        method: 'POST',
        url: `/api/games/${gameId}/votes`,
        payload: {
          commandId: `live-vote-${step}`,
          actorId: humanId,
          expectedRevision: view.revision,
          targetPlayerId: view.legalVoteTargetIds[0],
        },
      });
    }
  }
  throw new Error('LIVE_FULL_GAME_NOT_FINISHED');
}

async function readFrames(server: TestServer, gameId: string): Promise<unknown[]> {
  const response = await server.inject({ method: 'GET', url: `/api/games/${gameId}/events?after=0` });
  const body = response.json() as { data: { frames: unknown[] } };
  return body.data.frames;
}

function readWordCards(dependencies: ServerDependencies, gameId: string): string[] {
  const rows = dependencies.database.sqlite
    .prepare('SELECT word_card FROM game_players WHERE game_id = ?')
    .all(gameId) as Array<{ word_card: string }>;
  return [...new Set(rows.map((row) => row.word_card))];
}

// 整局公开通道隔离：硬类别（凭据/营地/信念内部字段）计入 isolationRecords 并参与全绿判定；
// 词牌明文（模型自发提及自己/他人词牌）只作 WARN 返回，不作硬失败——对齐策略级 ownWordWarn 口径。
function scanFullGame(
  channel: string,
  serialized: string,
  config: LiveConfig,
  words: readonly string[],
): { warn: boolean; hardPass: boolean } {
  const hard = scan(channel, serialized, [
    credentialSentinels(config.baseUrl, config.apiKey),
    CAMP_SENTINELS,
    BELIEF_INTERNAL_SENTINELS,
  ]);
  isolationRecords.push(...hard);
  const wordResults = scan(channel, serialized, wordSentinels([...words]));
  return { warn: wordResults.some((result) => !result.pass), hardPass: hard.every((r) => r.pass) };
}

// —— 整局调度：优先经服务端整栈（HTTP + SQLite）；本机 better-sqlite3 原生依赖不可用时，
// 回退“纯状态机等价驱动”——直驱 @sheishiwodi/shared 的同源 reducer 与内容校验，
// 用真实多模型策略把整局走到终局，我方以确定性方式模拟真人玩家。两条路径均全程脱敏。
async function runFullGame(config: LiveConfig, client: TokendanceClient): Promise<FullGameRecord> {
  try {
    return await runFullGameServer(config, client);
  } catch (error) {
    // 整栈失败（多为本机 better-sqlite3 原生绑定运行时加载失败）→ 回退纯状态机等价驱动。
    console.log(
      `[test:live] 服务端整栈不可用（${error instanceof Error ? error.name : 'Error'}，多为本机原生依赖缺失），` +
        '回退纯状态机等价驱动。',
    );
    return runFullGamePure(config, client);
  }
}

async function runFullGameServer(
  config: LiveConfig,
  client: TokendanceClient,
): Promise<FullGameRecord> {
  const { buildServer } = (await import('../../apps/server/src/server.js')) as {
    buildServer: (options: unknown) => unknown;
  };
  const { createTestEnvironment } = (await import('../../apps/server/src/test-environment.js')) as {
    createTestEnvironment: () => unknown;
  };
  const environment = createTestEnvironment() as {
    dependencies: ServerDependencies;
    cleanup: () => void;
  };
  const roleModelMap: Record<string, string> = { ...resolvedModels };
  const server = buildServer({
    ...environment.dependencies,
    agentPolicyFactory: () =>
      new TokendanceAgentPolicy({
        client,
        roleModelMap,
        maxSystemRetries: config.maxRetries,
        retryDelayMs: config.retryDelayMs,
        debug: true,
      }),
    backgroundAdvance: false,
  }) as unknown as TestServer;

  const startedAt = Date.now();
  try {
    const created = await createGame(server);
    const finalView = await driveHumanToEnd(server, created.gameId, created.human.playerId);
    const totalMs = Date.now() - startedAt;

    const frames = await readFrames(server, created.gameId);
    const words = readWordCards(environment.dependencies, created.gameId);
    const { warn, hardPass } = scanFullGame('fullGameFrames', JSON.stringify(frames), config, words);

    return {
      mode: 'server',
      status: finalView.status,
      winnerCamp: null,
      endReason: null,
      rounds: finalView.round?.number ?? 0,
      frames: frames.length,
      agentCalls: 0,
      humanActions: 0,
      contentRejections: 0,
      wordMentionWarn: warn,
      totalMs,
      isolationPass: hardPass,
    };
  } finally {
    await server.close();
    environment.cleanup();
  }
}

// —— 纯状态机整局驱动（无原生依赖） —— //

interface DriverDeps {
  ids: IdSource;
  clock: Clock;
  random: RandomSource;
}

class DriverIds implements IdSource {
  private value = 0;
  nextId(kind: 'game' | 'player' | 'event'): string {
    this.value += 1;
    return `${kind}-${this.value}`;
  }
}

const DRIVER_CLOCK: Clock = { now: () => '2026-08-16T12:00:00.000Z' };
// random=0.5：配对选首个词对，卧底落在某个 AI 座位 → 模拟真人玩家为平民，
// 更自然、且能覆盖更多轮次与旁观续局闸。
const DRIVER_RANDOM: RandomSource = { next: () => 0.5 };

const DRIVER_PAIR = {
  id: 'live-pair',
  civilianWord: '牛奶',
  undercoverWord: '豆浆',
  category: '饮品',
  difficulty: 'easy' as const,
  enabled: true,
};

// 模拟真人：短、非泄漏、按词牌与轮次轮换的线索（均 ≤40 字、≤2 句、绝不含自己词牌）。
const HUMAN_CLUES: Record<string, string[]> = {
  牛奶: ['早餐常喝的白色饮品', '小孩子长身体常喝的', '咖啡里常加的那种', '放冰箱冷藏的营养品'],
  豆浆: ['传统早餐里的热饮', '街边早点常见的一种', '磨出来的醇香饮品', '配油条很搭的那种'],
};
const HUMAN_CLUE_FALLBACK = ['这是生活里常见的东西', '大家平时应该都接触过', '挺日常的一个物件'];
const HUMAN_DEFENSE = '我的描述都是真实感受，我不是卧底';

function humanSpeech(word: string, round: number): string {
  const pool = HUMAN_CLUES[word] ?? HUMAN_CLUE_FALLBACK;
  return pool[(round - 1) % pool.length] ?? pool[0]!;
}

function pushPublic(timeline: PublicTimelineItem[], events: readonly GameEvent[]): void {
  for (const event of events) {
    if (event.visibility === 'public') {
      timeline.push({
        eventSeq: event.eventSeq,
        type: event.type,
        occurredAt: event.occurredAt,
        payload: event.payload,
      });
    }
  }
}

function isContentRejected(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith('CONTENT_REJECTED');
}

function applyHumanAction(
  snapshot: GameSnapshot,
  deps: DriverDeps,
  commandId: string,
): { snapshot: GameSnapshot; events: readonly GameEvent[] } {
  const round = snapshot.round!;
  const humanId = snapshot.humanPlayerId;
  const human = snapshot.players.find((player) => player.playerId === humanId)!;
  const base = { commandId, gameId: snapshot.gameId, actorId: humanId, expectedRevision: snapshot.revision };
  if (round.actionType === 'describe') {
    return submitDescription(
      snapshot,
      { type: 'SubmitDescription', ...base, text: humanSpeech(human.wordCard, round.number) },
      deps,
    );
  }
  if (round.actionType === 'defend') {
    return submitDefense(snapshot, { type: 'SubmitDefense', ...base, text: HUMAN_DEFENSE }, deps);
  }
  const target =
    round.actionType === 'revote'
      ? round.tieCandidateIds.find((id) => id !== humanId) ?? round.tieCandidateIds[0]!
      : snapshot.players.find((player) => player.alive && player.playerId !== humanId)!.playerId;
  return submitVote(snapshot, { type: 'SubmitVote', ...base, targetPlayerId: target }, deps);
}

function applyAgentAction(
  snapshot: GameSnapshot,
  actorId: string,
  output: SpeechActionOutput | VoteActionOutput,
  deps: DriverDeps,
  commandId: string,
): { snapshot: GameSnapshot; events: readonly GameEvent[] } {
  const round = snapshot.round!;
  const base = { commandId, gameId: snapshot.gameId, actorId, expectedRevision: snapshot.revision };
  if (round.actionType === 'describe') {
    return submitDescription(
      snapshot,
      { type: 'SubmitDescription', ...base, text: (output as SpeechActionOutput).text },
      deps,
    );
  }
  if (round.actionType === 'defend') {
    return submitDefense(
      snapshot,
      { type: 'SubmitDefense', ...base, text: (output as SpeechActionOutput).text },
      deps,
    );
  }
  return submitVote(
    snapshot,
    { type: 'SubmitVote', ...base, targetPlayerId: (output as VoteActionOutput).targetPlayerId },
    deps,
  );
}

async function runFullGamePure(config: LiveConfig, client: TokendanceClient): Promise<FullGameRecord> {
  const deps: DriverDeps = { ids: new DriverIds(), clock: DRIVER_CLOCK, random: DRIVER_RANDOM };
  const created = createPreparingGame(
    {
      type: 'CreateGame',
      commandId: 'live-create',
      human: { displayName: '小祎', silhouette: 'silhouette_a' },
      difficulty: 'easy',
    },
    [DRIVER_PAIR],
    deps,
  );
  const startTransition = startPreparingGame(
    created.snapshot,
    {
      type: 'StartGame',
      commandId: 'live-start',
      gameId: created.snapshot.gameId,
      actorId: created.snapshot.humanPlayerId,
      expectedRevision: created.snapshot.revision,
    },
    deps,
  );

  let snapshot = startTransition.snapshot;
  const timeline: PublicTimelineItem[] = [];
  pushPublic(timeline, startTransition.events);

  const policy = new TokendanceAgentPolicy({
    client,
    roleModelMap: { ...resolvedModels },
    maxSystemRetries: config.maxRetries,
    retryDelayMs: config.retryDelayMs,
    debug: true,
  });

  const humanId = snapshot.humanPlayerId;
  const startedAt = Date.now();
  let agentCalls = 0;
  let humanActions = 0;
  let contentRejections = 0;
  let rounds = 0;
  let cmdSeq = 0;
  const nextCmd = (): string => `live-drv-${(cmdSeq += 1)}`;
  const terminate = (reason: string): void => {
    const result = terminateForSystemError(
      snapshot,
      {
        type: 'TerminateForSystemError',
        commandId: nextCmd(),
        gameId: snapshot.gameId,
        actorId: humanId,
        expectedRevision: snapshot.revision,
        failedActionId: `drv-${cmdSeq}`,
        errorType: reason,
      },
      deps,
    );
    snapshot = result.snapshot;
    pushPublic(timeline, result.events);
  };

  for (let step = 0; step < 200; step += 1) {
    rounds = Math.max(rounds, snapshot.round?.number ?? rounds);

    if (snapshot.status === 'awaiting_spectator') {
      const result = continueSpectating(
        snapshot,
        {
          type: 'ContinueSpectating',
          commandId: nextCmd(),
          gameId: snapshot.gameId,
          actorId: humanId,
          expectedRevision: snapshot.revision,
        },
        deps,
      );
      snapshot = result.snapshot;
      pushPublic(timeline, result.events);
      continue;
    }
    if (snapshot.status !== 'in_progress' || !snapshot.round) break;

    const actorId = snapshot.round.currentActorId;
    const actor = snapshot.players.find((player) => player.playerId === actorId);
    if (!actor) break;

    if (actor.kind !== 'agent') {
      const result = applyHumanAction(snapshot, deps, nextCmd());
      snapshot = result.snapshot;
      pushPublic(timeline, result.events);
      humanActions += 1;
      continue;
    }

    const actionType = snapshot.round.actionType;
    const input = projectAgentTurnInput(snapshot, actorId, timeline, policy.priorBeliefs(actorId));
    let applied = false;
    for (let attempt = 0; attempt <= 3 && !applied; attempt += 1) {
      let output: SpeechActionOutput | VoteActionOutput;
      try {
        output = await policy.act(input, { agentRoleId: actor.agentRoleId ?? actorId });
        agentCalls += 1;
      } catch (error) {
        errorRecords.push({
          role: actor.agentRoleId ?? actorId,
          action: actionType,
          code: errorCodeOf(error),
        });
        terminate('agent_system_error');
        applied = true;
        break;
      }
      try {
        const result = applyAgentAction(snapshot, actorId, output, deps, nextCmd());
        snapshot = result.snapshot;
        pushPublic(timeline, result.events);
        applied = true;
      } catch (error) {
        if (isContentRejected(error)) {
          contentRejections += 1;
          continue;
        }
        throw error;
      }
    }
    if (!applied && snapshot.status === 'in_progress') terminate('content_rejected_limit');
  }

  const totalMs = Date.now() - startedAt;
  const words = allWordCards(snapshot);
  const { warn, hardPass } = scanFullGame('fullGameTimeline', JSON.stringify(timeline), config, words);

  return {
    mode: 'pure',
    status: snapshot.status,
    winnerCamp: snapshot.winnerCamp ?? null,
    endReason: snapshot.endReason ?? null,
    rounds,
    frames: timeline.length,
    agentCalls,
    humanActions,
    contentRejections,
    wordMentionWarn: warn,
    totalMs,
    isolationPass: hardPass,
  };
}

function hasToken(token: string): boolean {
  return process.argv.slice(2).includes(token);
}

async function main(): Promise<void> {
  let config: LiveConfig;
  try {
    config = resolveLiveConfig({ fullGame: hasToken('full') || undefined });
  } catch (error) {
    if (error instanceof LiveGateError) {
      console.error(`[test:live] 门禁失败：${error.message}`);
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  const policyOnly = hasToken('policy') && !config.fullGame;
  console.log(
    `[test:live] 编排器启动：策略级${config.fullGame ? ' + 可选整局' : ''}${policyOnly ? '（仅策略级）' : ''}（输出已脱敏）。`,
  );

  const client = new TokendanceClient({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    timeoutMs: config.timeoutMs,
    defaultBody: config.extraBody,
  });

  await runPolicyLevel(config, client);

  let fullGame: FullGameRecord | null = null;
  if (config.fullGame) {
    fullGame = await runFullGame(config, client);
  }

  // —— 汇总判定 ——
  const isolationFail = isolationRecords.some((record) => !record.pass);
  const structuralFail = policyRecords.some(
    (record) => !record.schemaPass || !record.beliefPass || record.targetLegal === false,
  );
  const systemFail = errorRecords.length > 0;
  const fullFail = fullGame !== null && (!fullGame.isolationPass ||
    !['finished', 'system_terminated'].includes(fullGame.status));

  const forbidden = [config.baseUrl, config.apiKey, 'Bearer '];
  const stamp = timestampStamp(new Date());
  try {
    const path = writeReport(
      'docs/acceptance/reports',
      `live-${stamp}.md`,
      {
        meta: {
          generatedAt: new Date().toISOString(),
          provider: config.provider,
          roleModels: resolvedModels,
          nodeVersion: process.version,
        },
        policy: policyRecords,
        isolation: isolationRecords,
        errors: errorRecords,
        fullGame,
      },
      forbidden,
    );
    console.log(`[test:live] 报告已写入：${path}`);
  } catch (error) {
    if (error instanceof ReportLeakError) {
      console.error('[test:live] 报告命中敏感串，已中止落盘（纵深防御触发）。');
      process.exitCode = 1;
      return;
    }
    throw error;
  }

  console.log(
    `[test:live] 汇总：策略调用=${policyRecords.length} 系统失败=${errorRecords.length} ` +
      `隔离未过=${isolationRecords.filter((r) => !r.pass).length} 结构失败=${structuralFail ? 1 : 0}` +
      `${fullGame ? ` 整局=${fullGame.status}` : ''}`,
  );

  if (isolationFail || structuralFail || systemFail || fullFail) {
    console.error('[test:live] 验收未全绿：存在隔离/结构/系统/整局失败，退出码 1。');
    process.exitCode = 1;
  } else {
    console.log('[test:live] 分层真实模型验收通过。');
  }
}

main().catch((error) => {
  // 仅上报错误类别，绝不回显底层 URL/Key。
  console.error(`[test:live] 未捕获异常：${error instanceof Error ? error.name : 'Error'}`);
  process.exitCode = 1;
});
