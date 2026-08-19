import { z } from 'zod';

import { difficultySchema, gameModeSchema, silhouetteSchema } from './enums.js';

const identifierSchema = z.string().trim().min(1).max(128);

const commandEnvelopeSchema = z
  .object({
    commandId: identifierSchema,
    gameId: identifierSchema,
    actorId: identifierSchema,
    expectedRevision: z.number().int().nonnegative(),
  })
  .strict();

export const createGameCommandSchema = z
  .object({
    type: z.literal('CreateGame'),
    commandId: identifierSchema,
    gameMode: gameModeSchema.optional(),
    participationMode: z.enum(['human', 'observer']).optional(),
    human: z
      .object({
        displayName: z.string().trim().min(1).max(12).default('玩家'),
        silhouette: silhouetteSchema,
      })
      .strict(),
    agentRoleIds: z.array(identifierSchema).min(3).max(8).optional(),
    requestBudget: z.number().int().min(1).max(500).optional(),
    difficulty: difficultySchema,
  })
  .strict();

export const startGameCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('StartGame'),
});

export const submitDescriptionCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('SubmitDescription'),
  text: z.string(),
});

export const submitDefenseCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('SubmitDefense'),
  text: z.string(),
});

export const submitVoteCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('SubmitVote'),
  targetPlayerId: identifierSchema,
});

export const submitGuessCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('SubmitGuess'),
  targetPlayerId: identifierSchema,
  guessedWord: z.string().trim().min(1).max(40),
});

export const continueSpectatingCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('ContinueSpectating'),
});

export const abandonGameCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('AbandonGame'),
  confirmed: z.literal(true),
});

export const terminateForSystemErrorCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('TerminateForSystemError'),
  failedActionId: identifierSchema,
  errorType: z.string().trim().min(1).max(64),
});

export const resolveInterruptedGameCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('ResolveInterruptedGame'),
  resolution: z.enum(['continue', 'start_new']),
});

export const disqualifyPlayerForRuleViolationCommandSchema = commandEnvelopeSchema.extend({
  type: z.literal('DisqualifyPlayerForRuleViolation'),
  failedActionId: identifierSchema,
  rule: z.literal('word_leak'),
});

export const createGameRequestSchema = createGameCommandSchema.omit({ type: true });
export const startGameRequestSchema = startGameCommandSchema.omit({ type: true, gameId: true });

export const submitDescriptionRequestSchema = submitDescriptionCommandSchema.omit({
  type: true,
  gameId: true,
});
export const submitDefenseRequestSchema = submitDefenseCommandSchema.omit({
  type: true,
  gameId: true,
});
export const submitVoteRequestSchema = submitVoteCommandSchema.omit({ type: true, gameId: true });
export const submitGuessRequestSchema = submitGuessCommandSchema.omit({ type: true, gameId: true });
export const continueSpectatingRequestSchema = continueSpectatingCommandSchema.omit({
  type: true,
  gameId: true,
});
export const abandonGameRequestSchema = abandonGameCommandSchema.omit({
  type: true,
  gameId: true,
});
export const automationControlRequestSchema = z
  .object({ mode: z.enum(['auto', 'paused', 'step']) })
  .strict();
export const addRequestBudgetSchema = z
  .object({ amount: z.number().int().min(1).max(500) })
  .strict();

export const gameCommandSchema = z.discriminatedUnion('type', [
  createGameCommandSchema,
  startGameCommandSchema,
  submitDescriptionCommandSchema,
  submitDefenseCommandSchema,
  submitVoteCommandSchema,
  submitGuessCommandSchema,
  continueSpectatingCommandSchema,
  abandonGameCommandSchema,
  resolveInterruptedGameCommandSchema,
  terminateForSystemErrorCommandSchema,
  disqualifyPlayerForRuleViolationCommandSchema,
]);

export type GameCommand = z.infer<typeof gameCommandSchema>;
export type CreateGameCommand = z.infer<typeof createGameCommandSchema>;
export type CreateGameRequest = z.infer<typeof createGameRequestSchema>;
export type StartGameCommand = z.infer<typeof startGameCommandSchema>;
export type StartGameRequest = z.infer<typeof startGameRequestSchema>;
export type SubmitDescriptionCommand = z.infer<typeof submitDescriptionCommandSchema>;
export type SubmitDescriptionRequest = z.infer<typeof submitDescriptionRequestSchema>;
export type SubmitDefenseCommand = z.infer<typeof submitDefenseCommandSchema>;
export type SubmitDefenseRequest = z.infer<typeof submitDefenseRequestSchema>;
export type SubmitVoteCommand = z.infer<typeof submitVoteCommandSchema>;
export type SubmitVoteRequest = z.infer<typeof submitVoteRequestSchema>;
export type SubmitGuessCommand = z.infer<typeof submitGuessCommandSchema>;
export type SubmitGuessRequest = z.infer<typeof submitGuessRequestSchema>;
export type ContinueSpectatingCommand = z.infer<typeof continueSpectatingCommandSchema>;
export type ContinueSpectatingRequest = z.infer<typeof continueSpectatingRequestSchema>;
export type AbandonGameCommand = z.infer<typeof abandonGameCommandSchema>;
export type AbandonGameRequest = z.infer<typeof abandonGameRequestSchema>;
export type AutomationControlRequest = z.infer<typeof automationControlRequestSchema>;
export type AddRequestBudgetRequest = z.infer<typeof addRequestBudgetSchema>;
export const resolveInterruptedGameRequestSchema = resolveInterruptedGameCommandSchema.omit({
  type: true,
  gameId: true,
  actorId: true,
  expectedRevision: true,
});
export type ResolveInterruptedGameCommand = z.infer<typeof resolveInterruptedGameCommandSchema>;
export type ResolveInterruptedGameRequest = z.infer<typeof resolveInterruptedGameRequestSchema>;
export type TerminateForSystemErrorCommand = z.infer<typeof terminateForSystemErrorCommandSchema>;
export type DisqualifyPlayerForRuleViolationCommand = z.infer<
  typeof disqualifyPlayerForRuleViolationCommandSchema
>;
