import { z } from 'zod';

import { providerModeSchema } from './model-profile.js';

const identifierSchema = z.string().trim().min(1).max(128);
const optionalAssetInputSchema = z.string().max(8_000_000).nullable().optional();

export const characterAssetStateSchema = z.enum([
  'avatar',
  'idle',
  'thinking',
  'speaking',
  'suspected',
  'eliminated',
]);

export const characterAssetsSchema = z
  .object({
    avatar: z.string().min(1).nullable(),
    idle: z.string().min(1).nullable(),
    thinking: z.string().min(1).nullable(),
    speaking: z.string().min(1).nullable(),
    suspected: z.string().min(1).nullable(),
    eliminated: z.string().min(1).nullable(),
  })
  .strict();

export const characterProfileSchema = z
  .object({
    profileId: identifierSchema,
    displayName: z.string().trim().min(1).max(12),
    intro: z.string().trim().max(120),
    personalityTags: z.array(z.string().trim().min(1).max(12)).max(3),
    personalityPrompt: z.string().trim().max(500),
    source: z.enum(['built_in', 'custom']),
    allowedParticipantKinds: z.array(z.enum(['human', 'agent'])).min(1),
    immutable: z.boolean(),
    complete: z.boolean(),
    selectedModelId: z.string().trim().min(1).max(200).nullable(),
    assets: characterAssetsSchema,
    createdAt: z.string().datetime().nullable(),
    updatedAt: z.string().datetime().nullable(),
  })
  .strict();

export const characterProfileListSchema = z
  .object({
    providerMode: providerModeSchema,
    providerConfigured: z.boolean(),
    reviewModelConfigured: z.boolean(),
    editable: z.boolean(),
    profiles: z.array(characterProfileSchema),
  })
  .strict();

export const upsertCharacterProfileSchema = z
  .object({
    displayName: z.string().trim().min(1).max(12),
    intro: z.string().trim().max(120).default(''),
    personalityTags: z.array(z.string().trim().min(1).max(12)).max(3).default([]),
    personalityPrompt: z.string().trim().max(500).default(''),
    selectedModelId: z.string().trim().min(1).max(200).nullable().optional(),
    assets: z
      .object({
        avatar: optionalAssetInputSchema,
        idle: optionalAssetInputSchema,
        thinking: optionalAssetInputSchema,
        speaking: optionalAssetInputSchema,
        suspected: optionalAssetInputSchema,
        eliminated: optionalAssetInputSchema,
      })
      .strict()
      .optional(),
  })
  .strict();

export type CharacterAssetState = z.infer<typeof characterAssetStateSchema>;
export type CharacterProfile = z.infer<typeof characterProfileSchema>;
export type CharacterProfileList = z.infer<typeof characterProfileListSchema>;
export type UpsertCharacterProfile = z.infer<typeof upsertCharacterProfileSchema>;
