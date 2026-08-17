import { useState, type FormEvent } from 'react';

import type { CreateGameRequest } from '@sheishiwodi/shared';

import { characterAssets } from '../character-assets';

interface NewGameFormProps {
  busy: boolean;
  onCreate(input: CreateGameRequest): Promise<void>;
  onOpenGuessMode(trigger: HTMLButtonElement): void;
}

export function NewGameForm({ busy, onCreate, onOpenGuessMode }: NewGameFormProps) {
  const [displayName, setDisplayName] = useState('');
  const [silhouette, setSilhouette] = useState<'silhouette_a' | 'silhouette_b'>('silhouette_a');
  const [difficulty, setDifficulty] = useState<'easy' | 'hard'>('easy');
  const [validation, setValidation] = useState<string | null>(null);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedName = displayName.trim();
    if (trimmedName.length > 12) {
      setValidation('名称不能超过 12 个字符');
      return;
    }
    setValidation(null);
    void onCreate({
      commandId: crypto.randomUUID(),
      human: {
        displayName: trimmedName || '玩家',
        silhouette,
      },
      difficulty,
    });
  };

  return (
    <form className="new-game" onSubmit={submit}>
      <header>
        <p className="eyebrow">新对局 · 固定四人阵容</p>
        <h1>谁是卧底</h1>
        <p className="lede">你只会看到自己的词牌。阵营、其他词牌和 AI 判断在终局前保持隐藏。</p>
      </header>

      <label className="field">
        <span>你的名字</span>
        <input
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
          placeholder="留空时使用“玩家”"
          maxLength={13}
        />
      </label>

      <fieldset>
        <legend>选择性别</legend>
        <div className="choice-grid choice-grid--silhouette">
          {([
            ['silhouette_a', '男性', characterAssets['human-male'].idle],
            ['silhouette_b', '女性', characterAssets['human-female'].idle],
          ] as const).map(([value, label, image]) => (
            <label className="choice-card choice-card--portrait" key={value}>
              <input
                type="radio"
                name="silhouette"
                value={value}
                checked={silhouette === value}
                onChange={() => setSilhouette(value)}
              />
              <img className="choice-portrait" src={image} alt="" />
              <strong>{label}</strong>
              <span className="choice-state">{silhouette === value ? '已选择' : '选择此形象'}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend>词语难度</legend>
        <div className="choice-grid">
          {([
            ['easy', '简单', '关联更直观，适合熟悉流程'],
            ['hard', '困难', '描述空间更窄，更考验措辞'],
          ] as const).map(([value, label, description]) => (
            <label className="choice-card choice-card--text" key={value}>
              <input
                type="radio"
                name="difficulty"
                value={value}
                checked={difficulty === value}
                onChange={() => setDifficulty(value)}
              />
              <strong>{label}</strong>
              <span>{description}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {validation && <p className="form-error">{validation}</p>}
      <div className="game-mode-actions" role="group" aria-label="选择游戏模式">
        <button className="primary-action" type="submit" disabled={busy}>
          {busy ? '正在创建…' : '经典模式'}
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={busy}
          aria-haspopup="dialog"
          onClick={(event) => onOpenGuessMode(event.currentTarget)}
        >
          猜词模式
        </button>
      </div>
    </form>
  );
}
