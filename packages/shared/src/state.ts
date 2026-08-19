import { z } from 'zod';

import {
  actionTypeSchema,
  campSchema,
  gamePhaseSchema,
  gameStatusSchema,
  playerKindSchema,
  silhouetteSchema,
} from './enums.js';
import { gameConfigSchema } from './views.js';
import { wordPairSnapshotSchema } from './word-pairs.js';

const identifierSchema = z.string().trim().min(1).max(128);

export const gamePlayerStateSchema = z
  .object({
    playerId: identifierSchema,
    seatIndex: z.number().int().nonnegative(),
    kind: playerKindSchema,
    displayName: z.string().trim().min(1).max(12),
    alive: z.boolean(),
    camp: campSchema,
    wordCard: z.string().trim().min(1),
    silhouette: silhouetteSchema.optional(),
    agentRoleId: identifierSchema.optional(),
    agentRoleDisplay: z.string().trim().min(1).max(32).optional(),
    agentPersonalityPrompt: z.string().trim().min(1).max(1000).optional(),
    agentModelId: z.string().trim().min(1).max(200).optional(),
    characterAssetKey: z.string().trim().min(1).max(128).optional(),
  })
  .strict();

export const privateVoteSchema = z
  .object({
    voterId: identifierSchema,
    targetPlayerId: identifierSchema,
  })
  .strict();

export const roundStateSchema = z
  .object({
    number: z.number().int().positive(),
    speakingOrder: z.array(identifierSchema).min(1),
    currentActorId: identifierSchema,
    actionType: actionTypeSchema,
    completedSpeakerIds: z.array(identifierSchema),
    completedVoterIds: z.array(identifierSchema),
    votes: z.array(privateVoteSchema),
    tieCandidateIds: z.array(identifierSchema),
  })
  .strict();

export const gameSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    gameId: identifierSchema,
    status: gameStatusSchema,
    phase: gamePhaseSchema,
    revision: z.number().int().nonnegative(),
    eventSeq: z.number().int().nonnegative(),
    streamSeq: z.number().int().nonnegative(),
    config: gameConfigSchema,
    humanPlayerId: identifierSchema,
    controllerId: identifierSchema.optional(),
    wordPair: wordPairSnapshotSchema,
    players: z.array(gamePlayerStateSchema).min(1),
    firstSpeakingOrder: z.array(identifierSchema).min(1),
    round: roundStateSchema.nullable(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    startedAt: z.string().datetime().optional(),
    resumeAfterSpectating: roundStateSchema.optional(),
    winnerCamp: campSchema.optional(),
    endReason: z
      .enum([
        'undercover_eliminated',
        'undercover_survived_to_two',
        'player_rule_violation',
        'abandoned_by_human',
        'model_failure_limit',
        'interrupted_not_resumed',
      ])
      .optional(),
  })
  .strict();

export type GamePlayerState = z.infer<typeof gamePlayerStateSchema>;
export type RoundState = z.infer<typeof roundStateSchema>;
export type GameSnapshot = z.infer<typeof gameSnapshotSchema>;
