import { useCallback, useEffect, useState } from 'react';

const STREAM_EVENT_TYPES = [
  'state_synced',
  'game_started',
  'round_started',
  'turn_started',
  'speech_published',
  'vote_progressed',
  'votes_revealed',
  'tie_declared',
  'revote_started',
  'round_ended_without_elimination',
  'player_eliminated',
  'player_rule_violated',
  'spectating_started',
  'game_abandoned',
  'terminal_reveal_ready',
  'game_system_terminated',
  'runtime_interrupted',
];

export function useGameStream(options: {
  gameId?: string;
  enabled: boolean;
  currentCursor(): number;
  synchronize(gameId: string, force: boolean): void;
}) {
  const { gameId, enabled, currentCursor, synchronize } = options;
  const [showRecovery, setShowRecovery] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!gameId || !enabled || typeof EventSource === 'undefined') {
      setShowRecovery(false);
      return;
    }

    let disposed = false;
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let noticeTimer: ReturnType<typeof setTimeout> | null = null;
    let failureCount = 0;

    const clearTimer = (timer: ReturnType<typeof setTimeout> | null) => {
      if (timer) clearTimeout(timer);
    };
    const connect = () => {
      if (disposed) return;
      source = new EventSource(`/api/games/${gameId}/stream?after=${currentCursor()}`);
      const handler = () => synchronize(gameId, false);
      for (const type of STREAM_EVENT_TYPES) source.addEventListener(type, handler);
      source.onmessage = handler;
      source.onopen = () => {
        failureCount = 0;
        clearTimer(reconnectTimer);
        clearTimer(noticeTimer);
        reconnectTimer = null;
        noticeTimer = null;
        setShowRecovery(false);
        synchronize(gameId, true);
      };
      source.onerror = () => {
        source?.close();
        if (disposed) return;
        failureCount += 1;
        if (!noticeTimer) {
          noticeTimer = setTimeout(() => setShowRecovery(true), 3_000);
        }
        const delay = Math.min(1_000 * 2 ** (failureCount - 1), 10_000);
        reconnectTimer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      disposed = true;
      source?.close();
      clearTimer(reconnectTimer);
      clearTimer(noticeTimer);
    };
  }, [currentCursor, enabled, gameId, retryToken, synchronize]);

  const retryNow = useCallback(() => {
    setShowRecovery(true);
    setRetryToken((value) => value + 1);
  }, []);

  return { showRecovery, retryNow };
}
