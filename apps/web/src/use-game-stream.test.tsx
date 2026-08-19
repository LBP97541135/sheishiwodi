import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useGameStream } from './use-game-stream';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('useGameStream', () => {
  it('断线三秒后提示，自动重连，并支持立即重试和成功后的权威同步', () => {
    vi.useFakeTimers();
    const instances: FakeEventSource[] = [];
    class FakeEventSource {
      onmessage: (() => void) | null = null;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      closed = false;
      readonly listeners = new Map<string, () => void>();

      constructor(readonly url: string) {
        instances.push(this);
      }

      addEventListener(type: string, handler: () => void) {
        this.listeners.set(type, handler);
      }

      close() {
        this.closed = true;
      }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const synchronize = vi.fn();
    const currentCursor = () => 8;
    const { result } = renderHook(() =>
      useGameStream({
        gameId: 'game-1',
        enabled: true,
        currentCursor,
        synchronize,
      }),
    );

    expect(instances[0]?.url).toBe('/api/games/game-1/stream?after=8');
    expect(instances[0]?.listeners.has('runtime_interrupted')).toBe(true);
    act(() => instances[0]?.listeners.get('runtime_interrupted')?.());
    expect(synchronize).toHaveBeenLastCalledWith('game-1', false);
    act(() => instances[0]?.onerror?.());
    expect(result.current.showRecovery).toBe(false);

    act(() => vi.advanceTimersByTime(3_000));
    expect(instances).toHaveLength(2);
    expect(result.current.showRecovery).toBe(true);

    act(() => result.current.retryNow());
    expect(instances).toHaveLength(3);
    act(() => instances.at(-1)?.onopen?.());
    expect(result.current.showRecovery).toBe(false);
    expect(synchronize).toHaveBeenLastCalledWith('game-1', true);
  });
});
