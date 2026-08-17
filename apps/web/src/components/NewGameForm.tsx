import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';

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
  const [nameDialogOpen, setNameDialogOpen] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [silhouetteDraft, setSilhouetteDraft] = useState<'silhouette_a' | 'silhouette_b'>('silhouette_a');
  const nameTriggerRef = useRef<HTMLButtonElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const nameDialogRef = useRef<HTMLElement>(null);

  const closeNameDialog = useCallback(() => {
    setNameDialogOpen(false);
    nameTriggerRef.current?.focus();
  }, []);

  const saveName = useCallback(() => {
    setDisplayName(nameDraft.trim());
    setSilhouette(silhouetteDraft);
    setValidation(null);
    closeNameDialog();
  }, [closeNameDialog, nameDraft, silhouetteDraft]);

  useEffect(() => {
    if (!nameDialogOpen) return;
    nameInputRef.current?.focus();
    nameInputRef.current?.select();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeNameDialog();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusable = Array.from(
        nameDialogRef.current?.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])') ?? [],
      );
      const currentIndex = focusable.indexOf(document.activeElement as HTMLElement);
      const nextIndex = event.shiftKey
        ? (currentIndex - 1 + focusable.length) % focusable.length
        : (currentIndex + 1) % focusable.length;
      event.preventDefault();
      focusable[nextIndex]?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeNameDialog, nameDialogOpen]);

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
      <header className="new-game__header">
        <p className="eyebrow">新对局 · 固定四人阵容</p>
        <h1 aria-label="谁是卧底">
          <button
            ref={nameTriggerRef}
            className="title-name-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-label={`编辑玩家身份，当前名称为${displayName.trim() || '玩家'}`}
            onClick={() => {
              setNameDraft(displayName);
              setSilhouetteDraft(silhouette);
              setNameDialogOpen(true);
            }}
          >
            谁
          </button>
          <span>是卧底</span>
        </h1>
        <p className="lede">你只会看到自己的词牌。阵营、其他词牌和 AI 判断在终局前保持隐藏。</p>
      </header>

      {validation && <p className="form-error">{validation}</p>}
      <div className="game-mode-actions" role="group" aria-label="选择游戏模式">
        <button className="primary-action game-mode-actions__classic" type="submit" disabled={busy}>
          <strong>{busy ? '正在创建…' : '经典模式'}</strong>
          {!busy && <span aria-hidden="true">开始游戏</span>}
        </button>
        <button
          className="secondary-action game-mode-actions__guess"
          type="button"
          disabled={busy}
          aria-haspopup="dialog"
          onClick={(event) => onOpenGuessMode(event.currentTarget)}
        >
          猜词模式
        </button>
      </div>

      <div className="new-game__setup">
        <fieldset className="difficulty-field">
          <legend>词语难度</legend>
          <div className="choice-grid choice-grid--difficulty">
            {([
              ['easy', '简单', '关联更直观'],
              ['hard', '困难', '更考验措辞'],
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
      </div>

      {nameDialogOpen && (
        <div
          className="coming-soon-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeNameDialog();
          }}
        >
          <section
            ref={nameDialogRef}
            className="coming-soon-dialog player-name-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="player-identity-title"
            aria-describedby="player-identity-description"
          >
            <p className="eyebrow">玩家身份</p>
            <h2 id="player-identity-title">编辑玩家身份</h2>
            <p id="player-identity-description">可以修改玩家名称和形象，名称留空时将使用“玩家”。</p>
            <label className="field">
              <span>玩家名称</span>
              <input
                ref={nameInputRef}
                value={nameDraft}
                maxLength={12}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return;
                  event.preventDefault();
                  saveName();
                }}
              />
            </label>
            <fieldset className="player-name-dialog__appearance">
              <legend>玩家形象</legend>
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
                      checked={silhouetteDraft === value}
                      onChange={() => setSilhouetteDraft(value)}
                    />
                    <img className="choice-portrait" src={image} alt="" />
                    <strong>{label}</strong>
                    <span className="choice-state">{silhouetteDraft === value ? '已选择' : '选择此形象'}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="player-name-dialog__actions">
              <button className="secondary-action" type="button" onClick={closeNameDialog}>
                取消
              </button>
              <button className="primary-action" type="button" onClick={saveName}>
                保存身份
              </button>
            </div>
          </section>
        </div>
      )}
    </form>
  );
}
