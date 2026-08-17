import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { audioAssets, sceneAssets } from './character-assets';
import { ExperienceControls, useExperienceSettings } from './experience-settings';

// jsdom 未实现 HTMLMediaElement.play/pause，会打印 “Not implemented”。
// 体验设置只关心开关状态与持久化，这里桩掉媒体方法，隔离音频播放副作用。
beforeEach(() => {
  vi.spyOn(window.HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('ExperienceControls', () => {
  const noop = () => undefined;

  it('按当前状态渲染音乐开关与背景单选，并透传交互回调', () => {
    const onToggleAudio = vi.fn();
    const onBackgroundChange = vi.fn();
    render(
      <ExperienceControls
        audioEnabled={false}
        audioNotice={null}
        backgroundTheme="paper"
        onToggleAudio={onToggleAudio}
        onBackgroundChange={onBackgroundChange}
      />,
    );

    const audioButton = screen.getByRole('button', { name: /背景音乐/ });
    expect(audioButton).toHaveTextContent('背景音乐：关');
    expect(audioButton).toHaveAttribute('aria-pressed', 'false');
    expect((screen.getByRole('radio', { name: '纸面' }) as HTMLInputElement).checked).toBe(true);
    expect(
      (screen.getByRole('radio', { name: '审讯室' }) as HTMLInputElement).checked,
    ).toBe(false);

    fireEvent.click(audioButton);
    expect(onToggleAudio).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('radio', { name: '审讯室' }));
    expect(onBackgroundChange).toHaveBeenCalledWith('interrogation');
  });

  it('开启音乐时按钮反映“开”态并置 aria-pressed', () => {
    render(
      <ExperienceControls
        audioEnabled
        audioNotice={null}
        backgroundTheme="interrogation"
        onToggleAudio={noop}
        onBackgroundChange={noop}
      />,
    );
    const audioButton = screen.getByRole('button', { name: /背景音乐/ });
    expect(audioButton).toHaveTextContent('背景音乐：开');
    expect(audioButton).toHaveAttribute('aria-pressed', 'true');
    expect(
      (screen.getByRole('radio', { name: '审讯室' }) as HTMLInputElement).checked,
    ).toBe(true);
  });

  it('存在提示时以 status 角色展示，不存在则不渲染', () => {
    const { rerender } = render(
      <ExperienceControls
        audioEnabled={false}
        audioNotice={null}
        backgroundTheme="paper"
        onToggleAudio={noop}
        onBackgroundChange={noop}
      />,
    );
    expect(screen.queryByRole('status')).toBeNull();
    rerender(
      <ExperienceControls
        audioEnabled={false}
        audioNotice="点击页面任意处即可开始播放背景音乐"
        backgroundTheme="paper"
        onToggleAudio={noop}
        onBackgroundChange={noop}
      />,
    );
    expect(screen.getByRole('status')).toHaveTextContent('点击页面任意处即可开始播放背景音乐');
  });
});

describe('useExperienceSettings', () => {
  it('背景音乐默认关闭、背景默认纸面且无场景底图', () => {
    const { result } = renderHook(() => useExperienceSettings(true));
    expect(result.current.audioEnabled).toBe(false);
    expect(result.current.backgroundTheme).toBe('paper');
    expect(result.current.backgroundImage).toBeUndefined();
  });

  it('从 localStorage 恢复已保存的开关与背景，审讯室时给出场景底图 URL', () => {
    localStorage.setItem('sheishiwodi:bgm', 'true');
    localStorage.setItem('sheishiwodi:background', 'interrogation');
    const { result } = renderHook(() => useExperienceSettings(true));
    expect(result.current.audioEnabled).toBe(true);
    expect(result.current.backgroundTheme).toBe('interrogation');
    expect(result.current.backgroundImage).toBe(`url("${sceneAssets.interrogationRoom}")`);
  });

  it('切换背景音乐会翻转状态并持久化到 localStorage', () => {
    const { result } = renderHook(() => useExperienceSettings(true));
    act(() => result.current.toggleAudio());
    expect(result.current.audioEnabled).toBe(true);
    expect(localStorage.getItem('sheishiwodi:bgm')).toBe('true');
    act(() => result.current.toggleAudio());
    expect(result.current.audioEnabled).toBe(false);
    expect(localStorage.getItem('sheishiwodi:bgm')).toBe('false');
  });

  it('切换到审讯室会持久化背景并生成场景底图，切回纸面清除底图', () => {
    const { result } = renderHook(() => useExperienceSettings(true));
    act(() => result.current.changeBackground('interrogation'));
    expect(result.current.backgroundTheme).toBe('interrogation');
    expect(localStorage.getItem('sheishiwodi:background')).toBe('interrogation');
    expect(result.current.backgroundImage).toContain(sceneAssets.interrogationRoom);
    act(() => result.current.changeBackground('paper'));
    expect(result.current.backgroundTheme).toBe('paper');
    expect(localStorage.getItem('sheishiwodi:background')).toBe('paper');
    expect(result.current.backgroundImage).toBeUndefined();
  });

  it('BGM 音源来自规范化的本地音频资源，非中文归档路径', () => {
    // ?url 结果在测试环境下可能是原始文件名或哈希名，只断言不再是仓库根 中文素材目录。
    expect(audioAssets.gameBgm).toBeTypeOf('string');
    expect(audioAssets.gameBgm).not.toContain('素材');
  });
});
