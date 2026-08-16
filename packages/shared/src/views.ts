import { z } from 'zod';

import { beliefSnapshotSchema } from './agent.js';
import {
  actionTypeSchema,
  campSchema,
  difficultySchema,
  gamePhaseSchema,
  gameStatusSchema,
  playerKindSchema,
  silhouetteSchema,
} from './enums.js';
import { publicTimelineItemSchema } from './events.js';

const identifierSchema = z.string().trim().min(1).max(128);

export const playerSchema = z
  .object({
    playerId: identifierSchema,
    seatIndex: z.number().int().nonnegative(),
    kind: playerKindSchema,
    displayName: z.string().trim().min(1).max(12),
    alive: z.boolean(),
    agentRoleDisplay: z.string().trim().min(1).max(32).optional(),
  })
  .strict();

export const humanProfileSchema = z
  .object({
    playerId: identifierSchema,
    displayName: z.string().trim().min(1).max(12),
    silhouette: silhouetteSchema,
    ownWordCard: z.string().trim().min(1),
  })
  .strict();

export const gameConfigSchema = z
  .object({
    difficulty: difficultySchema,
    undercoverCount: z.number().int().positive(),
  })
  .strict();

export const roundViewSchema = z.object({
  number: z.number().int().positive(),
  speakingOrder: z.array(identifierSchema),
  currentActorId: identifierSchema.nullable(),
  actionType: actionTypeSchema.nullable(),
  tieCandidateIds: z.array(identifierSchema),
});

export { publicTimelineItemSchema } from './events.js';

export const revealPlayerSchema = z
  .object({
    playerId: identifierSchema,
    seatIndex: z.number().int().nonnegative(),
    camp: campSchema,
    wordCard: z.string().trim().min(1),
  })
  .strict();

export const finaleRevealSchema = z
  .object({
    wordPair: z
      .object({
        civilianWord: z.string().trim().min(1),
        undercoverWord: z.string().trim().min(1),
        category: z.string().trim().min(1),
      })
      .strict(),
    players: z.array(revealPlayerSchema).min(1),
  })
  .strict()
  .superRefine((reveal, context) => {
    const seats = reveal.players.map((player) => player.seatIndex);
    if (new Set(seats).size !== seats.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '终局揭晓座位不能重复',
        path: ['players'],
      });
    }
    for (let index = 1; index < seats.length; index += 1) {
      if (seats[index - 1]! > seats[index]!) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: '终局揭晓必须按座位顺序排列',
          path: ['players'],
        });
        break;
      }
    }
  });

export const finaleAgentActionSchema = z
  .object({
    actionId: identifierSchema,
    playerId: identifierSchema,
    roundNumber: z.number().int().positive(),
    actionType: actionTypeSchema,
    baseRevision: z.number().int().nonnegative(),
    belief: beliefSnapshotSchema,
    output: z.record(z.unknown()),
    completedAt: z.string().datetime(),
  })
  .strict();

export const factReviewSchema = z
  .object({
    agentActions: z.array(finaleAgentActionSchema),
  })
  .strict();

export const operationalStatusSchema = z.object({
  state: z.enum(['idle', 'waiting_human', 'agent_working', 'retrying']),
  actorId: identifierSchema.optional(),
  retry: z
    .object({
      current: z.number().int().min(1).max(3),
      total: z.literal(3),
      errorType: z.string().trim().min(1),
    })
    .optional(),
});

export const humanGameViewSchema = z
  .object({
    gameId: identifierSchema,
    status: gameStatusSchema,
    phase: gamePhaseSchema,
    revision: z.number().int().nonnegative(),
    eventCursor: z.number().int().nonnegative(),
    config: gameConfigSchema,
    human: humanProfileSchema,
    players: z.array(playerSchema).min(1),
    round: roundViewSchema.nullable(),
    publicTimeline: z.array(publicTimelineItemSchema),
    voteProgress: z.object({
      completedPlayerIds: z.array(identifierSchema),
    }),
    legalVoteTargetIds: z.array(identifierSchema),
    winnerCamp: z.enum(['civilian', 'undercover']).optional(),
    endReason: z
      .enum([
        'undercover_eliminated',
        'undercover_survived_to_two',
        'abandoned_by_human',
        'model_failure_limit',
      ])
      .optional(),
    reveal: finaleRevealSchema.optional(),
    factReview: factReviewSchema.optional(),
    allowedCommands: z.array(z.string().trim().min(1)),
    operationalStatus: operationalStatusSchema,
  })
  .strict()
  .superRefine((view, context) => {
    if (view.status === 'finished') {
      if (!view.winnerCamp) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: '正常终局必须包含胜方',
          path: ['winnerCamp'],
        });
      }
      if (!view.reveal) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: '正常终局必须包含揭晓事实',
          path: ['reveal'],
        });
      }
      if (!view.factReview) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          message: '正常终局必须包含事实复盘',
          path: ['factReview'],
        });
      }
      return;
    }
    if (view.winnerCamp) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '非正常终局不得包含胜方',
        path: ['winnerCamp'],
      });
    }
    if (view.reveal) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '正常终局前不得包含揭晓事实',
        path: ['reveal'],
      });
    }
    if (view.factReview) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: '正常终局前不得包含事实复盘',
        path: ['factReview'],
      });
    }
  });

export const activeGameDataSchema = z
  .object({
    game: humanGameViewSchema.nullable(),
  })
  .strict();

export type Player = z.infer<typeof playerSchema>;
export type HumanProfile = z.infer<typeof humanProfileSchema>;
export type GameConfig = z.infer<typeof gameConfigSchema>;
export type RoundView = z.infer<typeof roundViewSchema>;
export type PublicTimelineItem = z.infer<typeof publicTimelineItemSchema>;
export type RevealPlayer = z.infer<typeof revealPlayerSchema>;
export type FinaleReveal = z.infer<typeof finaleRevealSchema>;
export type FinaleAgentAction = z.infer<typeof finaleAgentActionSchema>;
export type FactReview = z.infer<typeof factReviewSchema>;
export type OperationalStatus = z.infer<typeof operationalStatusSchema>;
export type HumanGameView = z.infer<typeof humanGameViewSchema>;
