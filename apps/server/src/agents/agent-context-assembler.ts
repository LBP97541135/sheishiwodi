import { createHash } from 'node:crypto';

import type {
  AgentTurnInput,
  BeliefSnapshot,
  GameSnapshot,
  PublicTimelineItem,
} from '@sheishiwodi/shared';

import { projectAgentTurnInput } from './agent-input-projector.js';

export interface AgentContextSource {
  listAgentBeliefs(gameId: string, playerId: string): BeliefSnapshot[];
  listPublicTimeline(gameId: string): PublicTimelineItem[];
}

export interface AgentContextProvenance {
  gameId: string;
  actorPlayerId: string;
  priorBeliefOwnerId: string;
  publicEventVisibility: 'public';
  publicEventCursor: number;
  inputHash: string;
}

const issuedProvenance = new WeakSet<object>();

export class AgentContextAssembler {
  constructor(private readonly source: AgentContextSource) {}

  assemble(snapshot: GameSnapshot, actorPlayerId: string) {
    const priorOwnBeliefs = this.source.listAgentBeliefs(snapshot.gameId, actorPlayerId);
    const publicEvents = this.source.listPublicTimeline(snapshot.gameId);
    const input = projectAgentTurnInput(
      snapshot,
      actorPlayerId,
      publicEvents,
      priorOwnBeliefs,
    );
    const provenance: AgentContextProvenance = {
      gameId: snapshot.gameId,
      actorPlayerId,
      priorBeliefOwnerId: actorPlayerId,
      publicEventVisibility: 'public',
      publicEventCursor: publicEvents.at(-1)?.eventSeq ?? 0,
      inputHash: hashAgentInput(input),
    };
    issuedProvenance.add(provenance);
    return { input, provenance };
  }
}

export function verifyAgentContextProvenance(
  provenance: AgentContextProvenance,
  input: AgentTurnInput,
) {
  return issuedProvenance.has(provenance) && provenance.inputHash === hashAgentInput(input);
}

function hashAgentInput(input: AgentTurnInput) {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}
