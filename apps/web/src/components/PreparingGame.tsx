import { useEffect, useState } from 'react';

import type { HumanGameView } from '@sheishiwodi/shared';

import { characterImageFor, characterKeyFor } from '../character-assets';
import { CharacterPortrait } from './CharacterPortrait';

interface PreparingGameProps {
  game: HumanGameView;
  busy: boolean;
  onStart(): Promise<void>;
  onAbandon(): Promise<void>;
}

export function PreparingGame({ game, busy, onStart, onAbandon }: PreparingGameProps) {
  const [revealed, setRevealed] = useState(false);
  const [confirmingAbandon, setConfirmingAbandon] = useState(false);

  useEffect(() => {
    setRevealed(false);
  }, [game.gameId]);

  return (
    <section className="preparing-game" aria-labelledby="prepare-title">
      <header className="prepare-header">
        <div>
          <p className="eyebrow">准备阶段 · {game.config.difficulty === 'easy' ? '简单' : '困难'}</p>
          <h1 id="prepare-title">{game.human ? '记住你的词牌' : '确认观战阵容'}</h1>
        </div>
        <span className="rule-stamp">{game.config.undercoverCount} 名卧底</span>
      </header>

      <div className="seats" aria-label="本局玩家">
        {game.players.map((player) => (
          <article className="seat" key={player.playerId}>
            <CharacterPortrait
              characterKey={characterKeyFor(player, game.human?.silhouette ?? 'silhouette_a')}
              src={characterImageFor(player, 'idle', game.human?.silhouette ?? 'silhouette_a')}
              label={player.displayName}
            />
            <strong>{player.displayName}</strong>
            <span>{player.kind === 'human' ? '你' : 'AI 玩家'}</span>
          </article>
        ))}
      </div>

      {game.human && (
        <>
          <button
            className={`word-card ${revealed ? 'word-card--revealed' : ''}`}
            type="button"
            aria-label={revealed ? '词牌已显示，点击隐藏' : '词牌已隐藏，点击显示'}
            aria-pressed={revealed}
            onClick={() => setRevealed((value) => !value)}
          >
            <span className="word-card__back">{revealed ? game.human.ownWordCard : '点击查看词牌'}</span>
          </button>
          <p className="privacy-note">翻牌只发生在当前浏览器，不会通知其他玩家，也不会写入对局记录。</p>
        </>
      )}
      <button className="primary-action" type="button" disabled={busy} onClick={() => void onStart()}>
        {busy ? '正在开始…' : game.human ? '我已记住，开始游戏' : '开始自动观战'}
      </button>
      {!confirmingAbandon ? (
        <button className="danger-link" type="button" disabled={busy} onClick={() => setConfirmingAbandon(true)}>
          放弃本局
        </button>
      ) : (
        <div className="abandon-confirm" role="alertdialog" aria-labelledby="prepare-abandon-title">
          <strong id="prepare-abandon-title">确认放弃本局？</strong>
          <p>本局不会产生阵营胜负，将保留不完整记录。</p>
          <div className="action-row">
            <button className="danger-action" type="button" disabled={busy} onClick={() => void onAbandon()}>
              {busy ? '放弃中…' : '放弃本局'}
            </button>
            <button
              className="secondary-action"
              type="button"
              disabled={busy}
              onClick={() => setConfirmingAbandon(false)}
            >
              取消
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
