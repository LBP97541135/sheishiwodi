import type {
  AgentTurnInput,
  BeliefSnapshot,
  SpeechActionOutput,
  VoteActionOutput,
} from '@sheishiwodi/shared';

import type { AgentContextProvenance } from './agent-context-assembler.js';

/**
 * 内部执行上下文：把当前行动者的角色标识传给策略，用于解析该角色的模型选择。
 * 该上下文不进入发给模型的白名单 AgentTurnInput，避免污染对外投影。
 */
export interface AgentActContext {
  agentRoleId: string;
  /** 内容校验失败后的秘密重生成提示；不携带被拦截原文。 */
  contentRetry?: 'format' | 'word_leak';
  trace?: {
    gameId: string;
    commandId: string;
    actionId: string;
    provenance: AgentContextProvenance;
  };
  /** 仅在进程内回传通过结构校验的 attempt，不进入模型输入或游戏事实。 */
  lifecycle?: { validatedAttemptId?: string };
}

export interface AgentPolicy {
  act(
    input: AgentTurnInput,
    context?: AgentActContext,
  ): Promise<SpeechActionOutput | VoteActionOutput>;
  priorBeliefs(playerId: string): readonly BeliefSnapshot[];
}
