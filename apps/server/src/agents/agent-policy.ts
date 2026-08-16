import type {
  AgentTurnInput,
  BeliefSnapshot,
  SpeechActionOutput,
  VoteActionOutput,
} from '@sheishiwodi/shared';

export interface AgentPolicy {
  act(input: AgentTurnInput): SpeechActionOutput | VoteActionOutput;
  priorBeliefs(playerId: string): readonly BeliefSnapshot[];
}
