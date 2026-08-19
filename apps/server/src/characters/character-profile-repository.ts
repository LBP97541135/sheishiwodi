import type { AgentRoleDefinition, ProviderMode } from '@sheishiwodi/shared';

import type { AppDatabase } from '../db/client.js';

export interface StoredCharacterProfile {
  profileId: string;
  displayName: string;
  intro: string;
  personalityTags: string[];
  personalityPrompt: string;
  modelBindings: Partial<Record<ProviderMode, string>>;
  assetManifest: Partial<Record<'avatar' | 'idle' | 'thinking' | 'speaking' | 'suspected' | 'eliminated', true>>;
  createdAt: string;
  updatedAt: string;
}

export class CharacterProfileRepository {
  constructor(private readonly database: AppDatabase) {}

  list(): StoredCharacterProfile[] {
    return this.database.sqlite
      .prepare(
        `SELECT profile_id, display_name, intro, personality_tags_json, personality_prompt,
                model_bindings_json, asset_manifest_json, created_at, updated_at
         FROM character_profiles ORDER BY created_at, profile_id`,
      )
      .all()
      .map(mapRow);
  }

  get(profileId: string): StoredCharacterProfile | null {
    const row = this.database.sqlite
      .prepare(
        `SELECT profile_id, display_name, intro, personality_tags_json, personality_prompt,
                model_bindings_json, asset_manifest_json, created_at, updated_at
         FROM character_profiles WHERE profile_id = ?`,
      )
      .get(profileId);
    return row ? mapRow(row) : null;
  }

  save(profile: StoredCharacterProfile) {
    this.database.sqlite
      .prepare(
        `INSERT INTO character_profiles (
           profile_id, display_name, intro, personality_tags_json, personality_prompt,
           model_bindings_json, asset_manifest_json, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(profile_id) DO UPDATE SET
           display_name = excluded.display_name,
           intro = excluded.intro,
           personality_tags_json = excluded.personality_tags_json,
           personality_prompt = excluded.personality_prompt,
           model_bindings_json = excluded.model_bindings_json,
           asset_manifest_json = excluded.asset_manifest_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        profile.profileId,
        profile.displayName,
        profile.intro,
        JSON.stringify(profile.personalityTags),
        profile.personalityPrompt,
        JSON.stringify(profile.modelBindings),
        JSON.stringify(profile.assetManifest),
        profile.createdAt,
        profile.updatedAt,
      );
  }

  delete(profileId: string) {
    return this.database.sqlite
      .prepare('DELETE FROM character_profiles WHERE profile_id = ?')
      .run(profileId).changes > 0;
  }

  isReferencedByActiveGame(profileId: string) {
    const rows = this.database.sqlite
      .prepare("SELECT snapshot_json FROM games WHERE status IN ('preparing', 'in_progress', 'awaiting_spectator')")
      .all() as Array<{ snapshot_json: string }>;
    return rows.some((row) => {
      const snapshot = JSON.parse(row.snapshot_json) as { players?: Array<{ agentRoleId?: string }> };
      return snapshot.players?.some((player) => player.agentRoleId === profileId) === true;
    });
  }

  resolveDefinition(profileId: string, providerMode: ProviderMode): AgentRoleDefinition | undefined {
    const profile = this.get(profileId);
    if (!profile || !isStoredProfileComplete(profile, providerMode)) return undefined;
    const tags = [...profile.personalityTags, '自定义', '稳定'].slice(0, 3) as [string, string, string];
    return {
      roleId: profile.profileId,
      displayName: profile.displayName,
      personalityTags: tags,
      personalityPrompt: profile.personalityPrompt,
      defaultModelId: profile.modelBindings[providerMode] ?? `fake:${profile.profileId}`,
    };
  }
}

export function isStoredProfileComplete(profile: StoredCharacterProfile, providerMode: ProviderMode) {
  const requiredAssets = ['avatar', 'idle', 'thinking', 'speaking', 'suspected', 'eliminated'] as const;
  return (
    profile.personalityPrompt.trim().length > 0 &&
    profile.personalityTags.length > 0 &&
    requiredAssets.every((key) => profile.assetManifest[key] === true) &&
    (providerMode === 'fake' || Boolean(profile.modelBindings[providerMode]))
  );
}

function mapRow(value: unknown): StoredCharacterProfile {
  const row = value as {
    profile_id: string;
    display_name: string;
    intro: string;
    personality_tags_json: string;
    personality_prompt: string;
    model_bindings_json: string;
    asset_manifest_json: string;
    created_at: string;
    updated_at: string;
  };
  return {
    profileId: row.profile_id,
    displayName: row.display_name,
    intro: row.intro,
    personalityTags: JSON.parse(row.personality_tags_json) as string[],
    personalityPrompt: row.personality_prompt,
    modelBindings: JSON.parse(row.model_bindings_json) as StoredCharacterProfile['modelBindings'],
    assetManifest: JSON.parse(row.asset_manifest_json) as StoredCharacterProfile['assetManifest'],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
