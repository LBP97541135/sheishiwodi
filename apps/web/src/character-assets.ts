import deepseekAvatar from './assets/characters/deepseek/avatar.webp';
import deepseekIdle from './assets/characters/deepseek/idle.webp';
import deepseekThinking from './assets/characters/deepseek/thinking.webp';
import deepseekSpeaking from './assets/characters/deepseek/speaking.webp';
import deepseekSuspected from './assets/characters/deepseek/suspected.webp';
import deepseekEliminated from './assets/characters/deepseek/eliminated.webp';
import doubaoAvatar from './assets/characters/doubao/avatar.webp';
import doubaoIdle from './assets/characters/doubao/idle.webp';
import doubaoThinking from './assets/characters/doubao/thinking.webp';
import doubaoSpeaking from './assets/characters/doubao/speaking.webp';
import doubaoSuspected from './assets/characters/doubao/suspected.webp';
import doubaoEliminated from './assets/characters/doubao/eliminated.webp';
import qwenAvatar from './assets/characters/qwen/avatar.webp';
import qwenIdle from './assets/characters/qwen/idle.webp';
import qwenThinking from './assets/characters/qwen/thinking.webp';
import qwenSpeaking from './assets/characters/qwen/speaking.webp';
import qwenSuspected from './assets/characters/qwen/suspected.webp';
import qwenEliminated from './assets/characters/qwen/eliminated.webp';
import maleAvatar from './assets/characters/human-male/avatar.webp';
import maleIdle from './assets/characters/human-male/idle.webp';
import maleThinking from './assets/characters/human-male/thinking.webp';
import maleSpeaking from './assets/characters/human-male/speaking.webp';
import maleSuspected from './assets/characters/human-male/suspected.webp';
import maleEliminated from './assets/characters/human-male/eliminated.webp';
import femaleAvatar from './assets/characters/human-female/avatar.webp';
import femaleIdle from './assets/characters/human-female/idle.webp';
import femaleThinking from './assets/characters/human-female/thinking.webp';
import femaleSpeaking from './assets/characters/human-female/speaking.webp';
import femaleSuspected from './assets/characters/human-female/suspected.webp';
import femaleEliminated from './assets/characters/human-female/eliminated.webp';
import interrogationRoom from './assets/scenes/interrogation-room.webp';
import gameBgm from './assets/audio/game-bgm.mp3?url';

export type CharacterState = 'idle' | 'thinking' | 'speaking' | 'suspected' | 'eliminated';
export type CharacterKey = 'deepseek' | 'doubao' | 'qwen' | 'human-male' | 'human-female';

export const characterAssets: Record<CharacterKey, Record<CharacterState, string>> = {
  deepseek: {
    idle: deepseekIdle,
    thinking: deepseekThinking,
    speaking: deepseekSpeaking,
    suspected: deepseekSuspected,
    eliminated: deepseekEliminated,
  },
  doubao: {
    idle: doubaoIdle,
    thinking: doubaoThinking,
    speaking: doubaoSpeaking,
    suspected: doubaoSuspected,
    eliminated: doubaoEliminated,
  },
  qwen: {
    idle: qwenIdle,
    thinking: qwenThinking,
    speaking: qwenSpeaking,
    suspected: qwenSuspected,
    eliminated: qwenEliminated,
  },
  'human-male': {
    idle: maleIdle,
    thinking: maleThinking,
    speaking: maleSpeaking,
    suspected: maleSuspected,
    eliminated: maleEliminated,
  },
  'human-female': {
    idle: femaleIdle,
    thinking: femaleThinking,
    speaking: femaleSpeaking,
    suspected: femaleSuspected,
    eliminated: femaleEliminated,
  },
};

export const characterAvatars: Record<CharacterKey, string> = {
  deepseek: deepseekAvatar,
  doubao: doubaoAvatar,
  qwen: qwenAvatar,
  'human-male': maleAvatar,
  'human-female': femaleAvatar,
};

export const sceneAssets = { interrogationRoom } as const;
export const audioAssets = { gameBgm } as const;

export const characterStateLabel: Record<CharacterState, string> = {
  idle: '待机',
  thinking: '思考中',
  speaking: '发言中',
  suspected: '被怀疑',
  eliminated: '已出局',
};

const agentNameToKey: Record<string, CharacterKey> = {
  DeepSeek: 'deepseek',
  豆包: 'doubao',
  千问: 'qwen',
};

export function characterKeyFor(
  player: { kind: 'human' | 'agent'; displayName: string },
  humanSilhouette: 'silhouette_a' | 'silhouette_b',
): CharacterKey {
  if (player.kind === 'agent') {
    return agentNameToKey[player.displayName] ?? 'deepseek';
  }
  return humanSilhouette === 'silhouette_b' ? 'human-female' : 'human-male';
}

export function characterImageFor(
  player: { kind: 'human' | 'agent'; displayName: string; agentRoleId?: string | undefined; characterAssetKey?: string | undefined },
  state: CharacterState,
  humanSilhouette: 'silhouette_a' | 'silhouette_b',
) {
  const assetKey = player.characterAssetKey ?? player.agentRoleId;
  if (player.kind === 'agent' && assetKey?.startsWith('custom-')) {
    return `/api/character-assets/${encodeURIComponent(assetKey)}/${state}.webp`;
  }
  return characterAssets[characterKeyFor(player, humanSilhouette)][state];
}
