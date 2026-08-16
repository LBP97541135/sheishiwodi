import { z } from 'zod';

import { actionTypeSchema } from './enums.js';
import { publicTimelineItemSchema } from './events.js';

const identifierSchema = z.string().trim().min(1).max(128);

export const opposingWordCandidateSchema = z
  .object({
    word: z.string().trim().min(1).max(40),
    confidence: z.number().min(0).max(1),
    evidence: z.string().trim().min(1).max(200),
  })
  .strict();

export const playerProbabilitySchema = z
  .object({
    playerId: identifierSchema,
    probability: z.number().min(0),
  })
  .strict();

export const beliefSnapshotSchema = z
  .object({
    opposingWordCandidates: z.array(opposingWordCandidateSchema),
    playerUndercoverProbabilities: z.array(playerProbabilitySchema).min(1),
    reasoningSummary: z.string().trim().min(1).max(300),
  })
  .strict();

export const agentTurnInputSchema = z
  .object({
    gameId: identifierSchema,
    baseRevision: z.number().int().nonnegative(),
    actor: z
      .object({
        playerId: identifierSchema,
        displayName: z.string().trim().min(1).max(32),
        ownWordCard: z.string().trim().min(1),
      })
      .strict(),
    publicConfig: z
      .object({
        undercoverCount: z.number().int().positive(),
        difficulty: z.enum(['easy', 'hard']),
      })
      .strict(),
    players: z.array(
      z
        .object({
          playerId: identifierSchema,
          displayName: z.string().trim().min(1).max(32),
          alive: z.boolean(),
          seatIndex: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    roundNumber: z.number().int().positive(),
    actionType: actionTypeSchema,
    legalTargets: z.array(identifierSchema),
    tieCandidates: z.array(identifierSchema),
    publicEvents: z.array(publicTimelineItemSchema),
    priorOwnBeliefs: z.array(beliefSnapshotSchema),
    personalityPrompt: z.string().trim().min(1).max(300),
  })
  .strict();

export const speechActionOutputSchema = z
  .object({
    belief: beliefSnapshotSchema,
    text: z.string(),
  })
  .strict();

export const voteActionOutputSchema = z
  .object({
    belief: beliefSnapshotSchema,
    targetPlayerId: identifierSchema,
    reason: z.string().trim().min(1).max(200),
  })
  .strict();

export function validateBeliefSnapshot(
  belief: z.infer<typeof beliefSnapshotSchema>,
  livingPlayerIds: readonly string[],
  undercoverCount: number,
) {
  const parsed = beliefSnapshotSchema.parse(belief);
  const probabilityIds = parsed.playerUndercoverProbabilities.map((entry) => entry.playerId);
  if (
    new Set(probabilityIds).size !== livingPlayerIds.length ||
    livingPlayerIds.some((playerId) => !probabilityIds.includes(playerId))
  ) {
    throw new Error('BELIEF_PLAYERS_INVALID');
  }
  const total = parsed.playerUndercoverProbabilities.reduce(
    (sum, entry) => sum + entry.probability,
    0,
  );
  if (Math.abs(total - undercoverCount) > 0.000_001) {
    throw new Error('BELIEF_TOTAL_INVALID');
  }
  return parsed;
}

export type BeliefSnapshot = z.infer<typeof beliefSnapshotSchema>;
export type AgentTurnInput = z.infer<typeof agentTurnInputSchema>;
export type SpeechActionOutput = z.infer<typeof speechActionOutputSchema>;
export type VoteActionOutput = z.infer<typeof voteActionOutputSchema>;
