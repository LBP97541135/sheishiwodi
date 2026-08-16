import { z } from 'zod';

export const gameStatusSchema = z.enum([
  'preparing',
  'in_progress',
  'awaiting_spectator',
  'finished',
  'abandoned',
  'system_terminated',
]);

export const gamePhaseSchema = z.enum([
  'preparing',
  'speaking',
  'voting',
  'tie_defense',
  'revoting',
  'ended',
]);

export const endReasonSchema = z.enum([
  'undercover_eliminated',
  'undercover_survived_to_two',
  'player_rule_violation',
  'abandoned_by_human',
  'model_failure_limit',
]);

export const campSchema = z.enum(['civilian', 'undercover']);
export const difficultySchema = z.enum(['easy', 'hard']);
export const playerKindSchema = z.enum(['human', 'agent']);
export const silhouetteSchema = z.enum(['silhouette_a', 'silhouette_b']);
export const actionTypeSchema = z.enum(['describe', 'vote', 'defend', 'revote']);

export type GameStatus = z.infer<typeof gameStatusSchema>;
export type GamePhase = z.infer<typeof gamePhaseSchema>;
export type EndReason = z.infer<typeof endReasonSchema>;
export type Camp = z.infer<typeof campSchema>;
export type Difficulty = z.infer<typeof difficultySchema>;
export type PlayerKind = z.infer<typeof playerKindSchema>;
export type Silhouette = z.infer<typeof silhouetteSchema>;
export type ActionType = z.infer<typeof actionTypeSchema>;
