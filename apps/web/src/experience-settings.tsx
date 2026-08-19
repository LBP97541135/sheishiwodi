import { useEffect, useRef, useState } from 'react';

import { audioAssets, sceneAssets } from './character-assets';

export type BackgroundTheme = 'paper' | 'interrogation';

interface ExperienceControlsProps {
  audioEnabled: boolean;
  audioNotice: string | null;
  backgroundTheme: BackgroundTheme;
  onToggleAudio(): void;
  onBackgroundChange(theme: BackgroundTheme): void;
  developerAvailable?: boolean;
  developerEnabled?: boolean;
  onToggleDeveloper?(): void;
}

export function ExperienceControls({
  audioEnabled,
  audioNotice,
  backgroundTheme,
  onToggleAudio,
  onBackgroundChange,
  developerAvailable = false,
  developerEnabled = false,
  onToggleDeveloper,
}: ExperienceControlsProps) {
  return (
    <div className="experience-controls" aria-label="显示与声音设置">
      <button
        type="button"
        className="utility-action"
        aria-pressed={audioEnabled}
        onClick={onToggleAudio}
      >
        <span aria-hidden="true">{audioEnabled ? '♫' : '×'}</span>
        背景音乐：{audioEnabled ? '开' : '关'}
      </button>
      {developerAvailable && onToggleDeveloper && (
        <button
          type="button"
          className="utility-action"
          aria-pressed={developerEnabled}
          onClick={onToggleDeveloper}
        >
          开发者模式：{developerEnabled ? '开' : '关'}
        </button>
      )}
      <fieldset className="background-picker">
        <legend>背景</legend>
        <div className="segmented-control">
          <label>
            <input
              type="radio"
              name="background-theme"
              value="paper"
              checked={backgroundTheme === 'paper'}
              onChange={() => onBackgroundChange('paper')}
            />
            <span>纸面</span>
          </label>
          <label>
            <input
              type="radio"
              name="background-theme"
              value="interrogation"
              checked={backgroundTheme === 'interrogation'}
              onChange={() => onBackgroundChange('interrogation')}
            />
            <span>审讯室</span>
          </label>
        </div>
      </fieldset>
      {audioNotice && (
        <span className="experience-notice" role="status">
          {audioNotice}
        </span>
      )}
    </div>
  );
}

export function useExperienceSettings(shouldPlay: boolean) {
  // 背景音乐默认关闭：首屏不触发被浏览器自动拦截的播放态，用户无感；需要时手动开。
  const [audioEnabled, setAudioEnabled] = useState(() => readBoolean('sheishiwodi:bgm', false));
  const [backgroundTheme, setBackgroundTheme] = useState<BackgroundTheme>(() =>
    readBackgroundTheme(),
  );
  const [audioNotice, setAudioNotice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (typeof Audio === 'undefined') return;
    const audio = new Audio(audioAssets.gameBgm);
    audio.loop = true;
    audio.preload = 'metadata';
    audio.volume = 0.24;
    const handleError = () => {
      // 卸载阶段清空 src 会触发媒体 error 事件；此时不应误报。
      // 仅当仍持有真实音源（非空、非页面地址）时才提示真正的加载失败。
      if (audio.src && !audio.src.endsWith('/')) setAudioNotice('背景音乐暂时无法播放');
    };
    audio.addEventListener('error', handleError);
    audioRef.current = audio;
    return () => {
      // 先摘掉监听，再清空 src，避免 StrictMode 双挂载清理触发伪报错。
      audio.removeEventListener('error', handleError);
      audio.pause();
      audio.src = '';
      audioRef.current = null;
    };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audioEnabled || !shouldPlay) {
      audio.pause();
      if (!shouldPlay) audio.currentTime = 0;
      return;
    }
    void playAudio(audio)
      .then(() => setAudioNotice(null))
      .catch(() => setAudioNotice('点击页面任意处即可开始播放背景音乐'));
  }, [audioEnabled, shouldPlay]);

  useEffect(() => {
    if (!shouldPlay || !audioEnabled) return;
    const unlock = () => {
      const audio = audioRef.current;
      if (audio?.paused) {
        void playAudio(audio).then(() => setAudioNotice(null)).catch(() => undefined);
      }
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [audioEnabled, shouldPlay]);

  const toggleAudio = () => {
    setAudioEnabled((current) => {
      const next = !current;
      localStorage.setItem('sheishiwodi:bgm', String(next));
      // 开关状态已由按钮自身表达，无需额外浮层提示；仅清除历史提示。
      setAudioNotice(null);
      return next;
    });
  };

  const changeBackground = (theme: BackgroundTheme) => {
    setBackgroundTheme(theme);
    localStorage.setItem('sheishiwodi:background', theme);
  };

  return {
    audioEnabled,
    audioNotice,
    backgroundTheme,
    backgroundImage:
      backgroundTheme === 'interrogation' ? `url("${sceneAssets.interrogationRoom}")` : undefined,
    toggleAudio,
    changeBackground,
  };
}

// 部分环境（jsdom、旧浏览器）的 HTMLMediaElement.play() 返回 undefined 而非 Promise，
// 统一包一层，避免对 undefined 调用 then 抛错。
function playAudio(audio: HTMLAudioElement): Promise<void> {
  try {
    const result = audio.play() as unknown;
    return result && typeof (result as Promise<void>).then === 'function'
      ? (result as Promise<void>)
      : Promise.resolve();
  } catch (error) {
    return Promise.reject(error instanceof Error ? error : new Error(String(error)));
  }
}

function readBoolean(key: string, fallback: boolean) {
  if (typeof localStorage === 'undefined') return fallback;
  const value = localStorage.getItem(key);
  return value === null ? fallback : value === 'true';
}

function readBackgroundTheme(): BackgroundTheme {
  if (typeof localStorage === 'undefined') return 'paper';
  return localStorage.getItem('sheishiwodi:background') === 'interrogation'
    ? 'interrogation'
    : 'paper';
}
