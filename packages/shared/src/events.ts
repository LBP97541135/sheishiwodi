import { z } from 'zod';

const identifierSchema = z.string().trim().min(1).max(128);

export const publicTimelineItemSchema = z
  .object({
    eventSeq: z.number().int().positive(),
    type: z.string().trim().min(1),
    occurredAt: z.string().datetime(),
    payload: z.record(z.unknown()),
  })
  .strict();

export const eventVisibilitySchema = z.enum([
  'public',
  'human_private',
  'post_game',
  'internal',
]);

export const gameEventTypeSchema = z.enum([
  'game_created',
  'game_started',
  'round_started',
  'turn_started',
  'speech_published',
  'vote_cast',
  'vote_progressed',
  'votes_revealed',
  'tie_declared',
  'revote_started',
  'player_eliminated',
  'player_rule_violated',
  'round_ended_without_elimination',
  'spectating_started',
  'belief_snapshotted',
  'game_finished',
  'terminal_reveal_ready',
  'game_abandoned',
  'game_system_terminated',
  'game_interruption_declined',
]);

export const gameEventSchema = z.object({
  eventId: identifierSchema,
  gameId: identifierSchema,
  eventSeq: z.number().int().positive(),
  type: gameEventTypeSchema,
  visibility: eventVisibilitySchema,
  occurredAt: z.string().datetime(),
  commandId: identifierSchema.optional(),
  actionId: identifierSchema.optional(),
  payload: z.record(z.unknown()),
});

export type EventVisibility = z.infer<typeof eventVisibilitySchema>;
export type GameEventType = z.infer<typeof gameEventTypeSchema>;
export type GameEvent = z.infer<typeof gameEventSchema>;
