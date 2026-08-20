import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

import sharp from 'sharp';
import {
  agentRoles,
  type CharacterAssetState,
  type CharacterProfile,
  type CharacterProfileList,
  type Clock,
  type UpsertCharacterProfile,
} from '@sheishiwodi/shared';

import type { ConfigLockSource, ModelProviderContext } from '../agents/model-profile-service.js';
import type { AgentRoleModelRepository } from '../db/agent-role-model-repository.js';
import {
  CharacterProfileRepository,
  isStoredProfileComplete,
  type StoredCharacterProfile,
} from './character-profile-repository.js';

const assetStates: readonly CharacterAssetState[] = [
  'avatar',
  'idle',
  'thinking',
  'speaking',
  'suspected',
  'eliminated',
];

export type CharacterProfileErrorCode =
  | 'PROFILE_NOT_FOUND'
  | 'PROFILE_LOCKED'
  | 'PROFILE_IMMUTABLE'
  | 'INVALID_IMAGE';

export class CharacterProfileError extends Error {
  constructor(readonly code: CharacterProfileErrorCode) {
    super(code);
    this.name = 'CharacterProfileError';
  }
}

export class CharacterProfileService {
  private readonly assetRoot: string;
  private readonly builtInAssetRoot: string;

  constructor(
    private readonly profiles: CharacterProfileRepository,
    private readonly roleModels: AgentRoleModelRepository,
    private readonly provider: ModelProviderContext,
    private readonly lock: ConfigLockSource,
    private readonly clock: Clock,
    assetRoot: string,
    builtInAssetRoot = resolve('apps/web/src/assets/characters'),
  ) {
    this.assetRoot = resolve(assetRoot);
    this.builtInAssetRoot = resolve(builtInAssetRoot);
    mkdirSync(this.assetRoot, { recursive: true });
  }

  list(): CharacterProfileList {
    const roleSelections = this.roleModels.listSelections();
    return {
      providerMode: this.provider.mode,
      providerConfigured: this.provider.configured,
      reviewModelConfigured: this.provider.reviewModelConfigured,
      editable: !this.lock.isGameLockedForConfig(),
      profiles: [...this.builtIns(roleSelections), ...this.profiles.list().map((profile) => this.project(profile))],
    };
  }

  async create(input: UpsertCharacterProfile): Promise<CharacterProfile> {
    if (this.lock.isGameLockedForConfig()) throw new CharacterProfileError('PROFILE_LOCKED');
    const now = this.clock.now();
    const profileId = `custom-${randomUUID()}`;
    const assetManifest = await this.writeAssets(profileId, input.assets ?? {}, {});
    const profile: StoredCharacterProfile = {
      profileId,
      displayName: input.displayName,
      intro: input.intro,
      personalityTags: input.personalityTags,
      personalityPrompt: input.personalityPrompt,
      modelBindings: input.selectedModelId
        ? { [this.provider.mode]: input.selectedModelId }
        : {},
      assetManifest,
      createdAt: now,
      updatedAt: now,
    };
    this.profiles.save(profile);
    return this.project(profile);
  }

  async update(profileId: string, input: UpsertCharacterProfile): Promise<CharacterProfile> {
    if (!profileId.startsWith('custom-')) throw new CharacterProfileError('PROFILE_IMMUTABLE');
    if (this.lock.isGameLockedForConfig() || this.profiles.isReferencedByActiveGame(profileId)) {
      throw new CharacterProfileError('PROFILE_LOCKED');
    }
    const current = this.profiles.get(profileId);
    if (!current) throw new CharacterProfileError('PROFILE_NOT_FOUND');
    const assetManifest = await this.writeAssets(profileId, input.assets ?? {}, current.assetManifest);
    const modelBindings = { ...current.modelBindings };
    if (input.selectedModelId === null) delete modelBindings[this.provider.mode];
    else if (input.selectedModelId) modelBindings[this.provider.mode] = input.selectedModelId;
    const next: StoredCharacterProfile = {
      ...current,
      displayName: input.displayName,
      intro: input.intro,
      personalityTags: input.personalityTags,
      personalityPrompt: input.personalityPrompt,
      modelBindings,
      assetManifest,
      updatedAt: this.clock.now(),
    };
    this.profiles.save(next);
    return this.project(next);
  }

  copy(profileId: string): CharacterProfile {
    if (this.lock.isGameLockedForConfig()) throw new CharacterProfileError('PROFILE_LOCKED');
    const customSource = this.profiles.get(profileId);
    const builtInSource = this.builtIns(this.roleModels.listSelections()).find((profile) =>
      profile.profileId === profileId && profile.allowedParticipantKinds.includes('agent'),
    );
    if (!customSource && !builtInSource) throw new CharacterProfileError('PROFILE_NOT_FOUND');

    const now = this.clock.now();
    const copyId = `custom-${randomUUID()}`;
    const sourceManifest = customSource?.assetManifest ?? Object.fromEntries(
      assetStates.map((state) => [state, true]),
    ) as StoredCharacterProfile['assetManifest'];
    try {
      for (const state of assetStates) {
        if (!sourceManifest[state]) continue;
        const source = customSource
          ? this.assetFile(customSource.profileId, state)
          : resolve(this.builtInAssetRoot, profileId, `${state}.webp`);
        if (!existsSync(source)) throw new CharacterProfileError('PROFILE_NOT_FOUND');
        const target = this.assetFile(copyId, state);
        mkdirSync(dirname(target), { recursive: true });
        copyFileSync(source, target);
      }
      const selectedModelId = builtInSource?.selectedModelId ?? null;
      const copied: StoredCharacterProfile = customSource
        ? {
            ...customSource,
            profileId: copyId,
            displayName: copyName(customSource.displayName),
            personalityTags: [...customSource.personalityTags],
            modelBindings: { ...customSource.modelBindings },
            assetManifest: { ...customSource.assetManifest },
            createdAt: now,
            updatedAt: now,
          }
        : {
            profileId: copyId,
            displayName: copyName(builtInSource!.displayName),
            intro: builtInSource!.intro,
            personalityTags: [...builtInSource!.personalityTags],
            personalityPrompt: builtInSource!.personalityPrompt,
            modelBindings: selectedModelId ? { [this.provider.mode]: selectedModelId } : {},
            assetManifest: sourceManifest,
            createdAt: now,
            updatedAt: now,
          };
      this.profiles.save(copied);
      return this.project(copied);
    } catch (error) {
      rmSync(this.profileDirectory(copyId), { recursive: true, force: true });
      throw error;
    }
  }

  delete(profileId: string) {
    if (!profileId.startsWith('custom-')) throw new CharacterProfileError('PROFILE_IMMUTABLE');
    if (this.lock.isGameLockedForConfig() || this.profiles.isReferencedByActiveGame(profileId)) {
      throw new CharacterProfileError('PROFILE_LOCKED');
    }
    if (!this.profiles.delete(profileId)) throw new CharacterProfileError('PROFILE_NOT_FOUND');
    const directory = this.profileDirectory(profileId);
    rmSync(directory, { recursive: true, force: true });
  }

  assetPath(profileId: string, state: CharacterAssetState) {
    if (!/^custom-[a-f0-9-]+$/.test(profileId) || !assetStates.includes(state)) {
      throw new CharacterProfileError('PROFILE_NOT_FOUND');
    }
    const profile = this.profiles.get(profileId);
    if (!profile?.assetManifest[state]) throw new CharacterProfileError('PROFILE_NOT_FOUND');
    return this.assetFile(profileId, state);
  }

  resolveCustomDefinition(profileId: string) {
    return this.profiles.resolveDefinition(profileId, this.provider.mode);
  }

  private project(profile: StoredCharacterProfile): CharacterProfile {
    return {
      profileId: profile.profileId,
      displayName: profile.displayName,
      intro: profile.intro,
      personalityTags: profile.personalityTags,
      personalityPrompt: profile.personalityPrompt,
      source: 'custom',
      allowedParticipantKinds: ['human', 'agent'],
      immutable: false,
      complete: isStoredProfileComplete(profile, this.provider.mode),
      selectedModelId: profile.modelBindings[this.provider.mode] ?? null,
      assets: Object.fromEntries(
        assetStates.map((state) => [
          state,
          profile.assetManifest[state]
            ? `/api/character-assets/${profile.profileId}/${state}.webp`
            : null,
        ]),
      ) as CharacterProfile['assets'],
      createdAt: profile.createdAt,
      updatedAt: profile.updatedAt,
    };
  }

  private builtIns(selections: Record<string, string>): CharacterProfile[] {
    const agents = agentRoles.map((role): CharacterProfile => ({
      profileId: role.roleId,
      displayName: role.displayName,
      intro: `${role.displayName} 内置厂商角色`,
      personalityTags: [...role.personalityTags],
      personalityPrompt: role.personalityPrompt,
      source: 'built_in',
      allowedParticipantKinds: ['human', 'agent'],
      immutable: true,
      complete: true,
      selectedModelId:
        selections[role.roleId] ??
        (this.provider.useBuiltInRoleDefaults ? role.defaultModelId : null),
      assets: builtInAssets(role.roleId),
      createdAt: null,
      updatedAt: null,
    }));
    return [
      humanBuiltIn('human-male', '男性玩家'),
      humanBuiltIn('human-female', '女性玩家'),
      ...agents,
    ];
  }

  private async writeAssets(
    profileId: string,
    updates: NonNullable<UpsertCharacterProfile['assets']>,
    current: StoredCharacterProfile['assetManifest'],
  ) {
    const next = { ...current };
    for (const state of assetStates) {
      const value = updates[state];
      if (value === undefined) continue;
      if (value === null) {
        rmSync(this.assetFile(profileId, state), { force: true });
        delete next[state];
        continue;
      }
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
      if (!match) throw new CharacterProfileError('INVALID_IMAGE');
      const source = Buffer.from(match[2]!, 'base64');
      if (source.byteLength === 0 || source.byteLength > 6 * 1024 * 1024) {
        throw new CharacterProfileError('INVALID_IMAGE');
      }
      let output: Buffer;
      try {
        const image = sharp(source, { animated: false, limitInputPixels: 4096 * 4096 });
        const metadata = await image.metadata();
        if (!metadata.width || !metadata.height || !['png', 'jpeg', 'webp'].includes(metadata.format ?? '') || (metadata.pages ?? 1) > 1) {
          throw new CharacterProfileError('INVALID_IMAGE');
        }
        const [width, height] = state === 'avatar' ? [256, 256] : [512, 640];
        output = await image
          .resize(width, height, { fit: 'cover', position: 'north' })
          .webp({ quality: 84 })
          .toBuffer();
      } catch (error) {
        if (error instanceof CharacterProfileError) throw error;
        throw new CharacterProfileError('INVALID_IMAGE');
      }
      const target = this.assetFile(profileId, state);
      const temporary = `${target}.tmp`;
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(temporary, output);
      renameSync(temporary, target);
      next[state] = true;
    }
    return next;
  }

  private profileDirectory(profileId: string) {
    const target = resolve(this.assetRoot, profileId);
    if (!target.startsWith(`${this.assetRoot}${sep}`)) throw new CharacterProfileError('PROFILE_NOT_FOUND');
    return target;
  }

  private assetFile(profileId: string, state: CharacterAssetState) {
    return resolve(this.profileDirectory(profileId), `${state}.webp`);
  }
}

function builtInAssets(profileId: string): CharacterProfile['assets'] {
  return Object.fromEntries(assetStates.map((state) => [state, `builtin:${profileId}/${state}`])) as CharacterProfile['assets'];
}

function humanBuiltIn(profileId: 'human-male' | 'human-female', displayName: string): CharacterProfile {
  return {
    profileId,
    displayName,
    intro: '内置人类玩家剪影，不可分配给 Agent。',
    personalityTags: [],
    personalityPrompt: '',
    source: 'built_in',
    allowedParticipantKinds: ['human'],
    immutable: true,
    complete: true,
    selectedModelId: null,
    assets: builtInAssets(profileId),
    createdAt: null,
    updatedAt: null,
  };
}

function copyName(displayName: string) {
  return `${displayName.slice(0, 10)}副本`;
}
