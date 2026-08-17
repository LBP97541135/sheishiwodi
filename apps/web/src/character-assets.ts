import deepseekIdle from './assets/characters/deepseek/idle.png';
import deepseekThinking from './assets/characters/deepseek/thinking.png';
import deepseekSpeaking from './assets/characters/deepseek/speaking.png';
import deepseekSuspected from './assets/characters/deepseek/suspected.png';
import deepseekEliminated from './assets/characters/deepseek/eliminated.png';
import doubaoIdle from './assets/characters/doubao/idle.png';
import doubaoThinking from './assets/characters/doubao/thinking.png';
import doubaoSpeaking from './assets/characters/doubao/speaking.png';
import doubaoSuspected from './assets/characters/doubao/suspected.png';
import doubaoEliminated from './assets/characters/doubao/eliminated.png';
import qwenIdle from './assets/characters/qwen/idle.png';
import qwenThinking from './assets/characters/qwen/thinking.png';
import qwenSpeaking from './assets/characters/qwen/speaking.png';
import qwenSuspected from './assets/characters/qwen/suspected.png';
import qwenEliminated from './assets/characters/qwen/eliminated.png';
import maleIdle from './assets/characters/human-male/idle.png';
import maleThinking from './assets/characters/human-male/thinking.png';
import maleSpeaking from './assets/characters/human-male/speaking.png';
import maleSuspected from './assets/characters/human-male/suspected.png';
import maleEliminated from './assets/characters/human-male/eliminated.png';
import femaleIdle from './assets/characters/human-female/idle.png';
import femaleThinking from './assets/characters/human-female/thinking.png';
import femaleSpeaking from './assets/characters/human-female/speaking.png';
import femaleSuspected from './assets/characters/human-female/suspected.png';
import femaleEliminated from './assets/characters/human-female/eliminated.png';
import interrogationRoom from './assets/scenes/interrogation-room.png';
import gameBgm from './assets/audio/game-bgm.wav?url';

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
